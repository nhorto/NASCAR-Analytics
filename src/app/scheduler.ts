// In-process weekly-refresh cron (launch plan D18). The schedule matches the
// GitHub Actions cadence (Mondays 12:00 UTC — Sunday Cup races have long
// cleared the 6h finality buffer). The refresh itself runs as a child process
// (the existing CLI), so the synchronous backfill/compute/export work never
// blocks the server's event loop; SQLite WAL + busy_timeout handle the
// cross-process write. An advisory lock in the shared db guarantees a single
// concurrent refresh even across restarts or a manual run.
import type { Database } from "bun:sqlite";
import { acquireLock, releaseLock } from "../providers/lock.ts";
import { logLine } from "./http.ts";
import type { Providers } from "../providers/index.ts";
import type { LivePayload } from "../domains/live/index.ts";
import type { CandidateAlert, VapidKeys } from "../domains/notifications/index.ts";
import { dispatchAlerts } from "./push.ts";

export const REFRESH_LOCK_NAME = "weekly-refresh";
/** Generous ceiling for a cold backfill; a crashed holder is taken over after this. */
export const REFRESH_LOCK_TTL_MS = 3 * 60 * 60 * 1000;

/** Next Monday 12:00 UTC strictly after `now` (today qualifies if noon is still ahead). */
export function nextRefreshAt(now: Date): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0),
  );
  let addDays = (1 - candidate.getUTCDay() + 7) % 7; // 1 = Monday
  if (addDays === 0 && candidate.getTime() <= now.getTime()) addDays = 7;
  candidate.setUTCDate(candidate.getUTCDate() + addDays);
  return candidate;
}

export type RefreshOutcome = "ran" | "skipped-lock" | "failed";

export interface ScheduledRefreshOpts {
  db: Database;
  log: { info: (m: string) => void; warn: (m: string) => void };
  /** Runs one refresh; resolves to the exit code. Default spawns the CLI. */
  runRefresh?: () => Promise<number>;
  holder?: string;
  now?: () => number;
}

function spawnRefreshCli(): Promise<number> {
  const child = Bun.spawn(["bun", "src/app/index.ts", "refresh"], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  return child.exited;
}

/** One lock-protected refresh attempt. Always releases the lock it took. */
export async function runScheduledRefresh(opts: ScheduledRefreshOpts): Promise<RefreshOutcome> {
  const holder = opts.holder ?? `server-${process.pid}`;
  const now = opts.now ?? Date.now;
  if (!acquireLock(opts.db, REFRESH_LOCK_NAME, holder, REFRESH_LOCK_TTL_MS, now())) {
    opts.log.warn(logLine("info", "refresh skipped — lock held", { lock: REFRESH_LOCK_NAME }));
    return "skipped-lock";
  }
  try {
    opts.log.info(logLine("info", "refresh starting", { holder }));
    const code = await (opts.runRefresh ?? spawnRefreshCli)();
    if (code !== 0) {
      opts.log.warn(logLine("error", "refresh failed", { holder, exitCode: code }));
      return "failed";
    }
    opts.log.info(logLine("info", "refresh finished", { holder }));
    return "ran";
  } catch (err) {
    opts.log.warn(logLine("error", "refresh threw", { holder, error: String(err) }));
    return "failed";
  } finally {
    releaseLock(opts.db, REFRESH_LOCK_NAME, holder);
  }
}

export interface RefreshScheduler {
  stop(): void;
  nextRunAt(): Date;
}

/** Arm a timer for the next slot; after each attempt (or failure) re-arm for the next. */
function startTimerLoop(
  label: string,
  nextAt: (now: Date) => Date,
  job: () => Promise<unknown>,
  log: ScheduledRefreshOpts["log"],
  now: () => number = Date.now,
): RefreshScheduler {
  let next = nextAt(new Date(now()));
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const delay = Math.max(0, next.getTime() - now());
    timer = setTimeout(async () => {
      await job();
      next = nextAt(new Date(now()));
      arm();
    }, delay);
  };
  arm();
  log.info(logLine("info", `${label} cron armed`, { nextRunAt: next.toISOString() }));
  return {
    stop: () => clearTimeout(timer),
    nextRunAt: () => next,
  };
}

export function startRefreshScheduler(opts: ScheduledRefreshOpts): RefreshScheduler {
  const now = opts.now ?? Date.now;
  return startTimerLoop(
    "refresh",
    nextRefreshAt,
    () => runScheduledRefresh(opts),
    opts.log,
    now,
  );
}

// ---------------------------------------------------------------------------
// Daily canary (WS-C). Same 09:00 UTC slot as the CI workflow it replaces
// once the server is live. No lock needed — a doubled canary run is harmless
// (feed_status rows are keyed by run time) and the CLI is cheap.
// ---------------------------------------------------------------------------

export const CANARY_HOUR_UTC = 9;

/** Next `hourUtc`:00 UTC strictly after `now`. */
export function nextDailyAt(now: Date, hourUtc: number): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0),
  );
  if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

function spawnCanaryCli(): Promise<number> {
  const child = Bun.spawn(["bun", "src/app/index.ts", "canary"], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  return child.exited;
}

export function startCanaryScheduler(opts: {
  log: ScheduledRefreshOpts["log"];
  runCanary?: () => Promise<number>;
  now?: () => number;
}): RefreshScheduler {
  return startTimerLoop(
    "canary",
    (d) => nextDailyAt(d, CANARY_HOUR_UTC),
    async () => {
      // The canary CLI exits 1 on any failing check — that's a report, not a
      // scheduler error; the alerting lives inside the CLI (recordAndAlert).
      const code = await (opts.runCanary ?? spawnCanaryCli)();
      if (code !== 0) opts.log.warn(logLine("info", "canary reported failures", { exitCode: code }));
    },
    opts.log,
    opts.now,
  );
}

// ---------------------------------------------------------------------------
// Predictions crons (WS-F, spec §9 cadence): Thursday 16:00 UTC (entry list +
// form) and Saturday 22:00 UTC (after qualifying — the predict CLI pulls the
// grid from the weekend feed and degrades to form-only when quals haven't
// run). No lock: the upsert is idempotent and last-write-wins.
// ---------------------------------------------------------------------------

export const PREDICT_THURSDAY = { dayUtc: 4, hourUtc: 16 } as const;
export const PREDICT_SATURDAY = { dayUtc: 6, hourUtc: 22 } as const;

/** Next `dayUtc` (0=Sun) at `hourUtc`:00 UTC strictly after `now`. */
export function nextWeeklyAt(now: Date, dayUtc: number, hourUtc: number): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0),
  );
  let addDays = (dayUtc - candidate.getUTCDay() + 7) % 7;
  if (addDays === 0 && candidate.getTime() <= now.getTime()) addDays = 7;
  candidate.setUTCDate(candidate.getUTCDate() + addDays);
  return candidate;
}

function spawnPredictCli(stage: "thursday" | "saturday"): Promise<number> {
  const child = Bun.spawn(["bun", "src/app/index.ts", "predict", "--stage", stage], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  return child.exited;
}

/** Two weekly slots sharing one handle; each run names its stage. */
export function startPredictionsScheduler(opts: {
  log: ScheduledRefreshOpts["log"];
  runPredict?: (stage: "thursday" | "saturday") => Promise<number>;
  now?: () => number;
}): RefreshScheduler {
  const run = async (stage: "thursday" | "saturday") => {
    const code = await (opts.runPredict ?? spawnPredictCli)(stage);
    if (code !== 0)
      opts.log.warn(logLine("error", "predictions run failed", { stage, exitCode: code }));
  };
  const thursday = startTimerLoop(
    "predictions-thursday",
    (d) => nextWeeklyAt(d, PREDICT_THURSDAY.dayUtc, PREDICT_THURSDAY.hourUtc),
    () => run("thursday"),
    opts.log,
    opts.now,
  );
  const saturday = startTimerLoop(
    "predictions-saturday",
    (d) => nextWeeklyAt(d, PREDICT_SATURDAY.dayUtc, PREDICT_SATURDAY.hourUtc),
    () => run("saturday"),
    opts.log,
    opts.now,
  );
  return {
    stop: () => {
      thursday.stop();
      saturday.stop();
    },
    nextRunAt: () =>
      thursday.nextRunAt().getTime() <= saturday.nextRunAt().getTime()
        ? thursday.nextRunAt()
        : saturday.nextRunAt(),
  };
}

// ---------------------------------------------------------------------------
// Race-day push dispatcher (WS-H). The live Worker's payload already carries
// the alerts its Durable Object derived, so the server consumes those instead
// of re-deriving them — one source of truth for what counts as an event, and
// no second copy of the snapshot-diff state machine.
//
// Poll cadence is deliberately slower than the live page's 5 s: a push is a
// notification, not a live board, and every poll is a Worker request.
// ---------------------------------------------------------------------------

export const PUSH_POLL_LIVE_MS = 20_000;
export const PUSH_POLL_IDLE_MS = 5 * 60_000;

export interface PushPollDeps {
  p: Pick<Providers, "db">;
  liveApiBase: string;
  seriesId: number;
  vapid: VapidKeys | null;
  log: ScheduledRefreshOpts["log"];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Injected in tests; defaults to the real dispatcher. */
  dispatch?: typeof dispatchAlerts;
}

export interface PushPollResult {
  live: boolean;
  alerts: number;
  sent: number;
  /** Next delay in ms — fast while racing, slow when idle. */
  nextDelayMs: number;
}

/** One poll of the live Worker, dispatching whatever alerts it reports. */
export async function pollAndDispatch(
  deps: PushPollDeps,
  wasLive: boolean,
): Promise<PushPollResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const idle: PushPollResult = { live: false, alerts: 0, sent: 0, nextDelayMs: PUSH_POLL_IDLE_MS };
  let payload: LivePayload;
  try {
    const res = await fetchImpl(`${deps.liveApiBase}/api/live?series=${deps.seriesId}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      deps.log.warn(logLine("error", "push poll: live feed unavailable", { status: res.status }));
      return idle;
    }
    payload = (await res.json()) as LivePayload;
  } catch (err) {
    deps.log.warn(logLine("error", "push poll failed", { error: String(err) }));
    return idle;
  }
  if (!payload?.ok || !payload.snapshot) return idle;

  const raceId = payload.snapshot.raceId;
  const raceName = payload.snapshot.runName ?? payload.snapshot.trackName ?? "the race";
  const alerts: CandidateAlert[] = (payload.alerts ?? []).map((a) => ({
    kind: a.kind as CandidateAlert["kind"],
    message: a.message,
    driverId: a.driverId,
    atLap: a.atLap,
    raceId,
  }));

  // The checkered flag isn't a diff event, so synthesize it from the
  // live→not-live transition; dedup keeps it to one per race.
  if (wasLive && !payload.live) {
    alerts.push({
      kind: "finish",
      message: `${raceName} is complete`,
      driverId: null,
      atLap: payload.snapshot.lap,
      raceId,
    });
  }

  const dispatch = deps.dispatch ?? dispatchAlerts;
  const outcome = await dispatch(deps.p, alerts, raceName, {
    vapid: deps.vapid,
    now: deps.now,
    log: deps.log,
    fetchImpl: deps.fetchImpl,
  });
  if (outcome.sent > 0)
    deps.log.info(logLine("info", "push alerts dispatched", { raceId, sent: outcome.sent }));
  return {
    live: payload.live === true,
    alerts: alerts.length,
    sent: outcome.sent,
    nextDelayMs: payload.live ? PUSH_POLL_LIVE_MS : PUSH_POLL_IDLE_MS,
  };
}

/** Poll forever, adapting the interval to whether a session is on track. */
export function startPushDispatcher(deps: PushPollDeps): RefreshScheduler {
  const now = deps.now ?? (() => new Date());
  let wasLive = false;
  let timer: ReturnType<typeof setTimeout>;
  let next = new Date(now().getTime() + PUSH_POLL_IDLE_MS);
  const arm = (delayMs: number) => {
    next = new Date(now().getTime() + delayMs);
    timer = setTimeout(async () => {
      const result = await pollAndDispatch(deps, wasLive);
      wasLive = result.live;
      arm(result.nextDelayMs);
    }, delayMs);
  };
  arm(0);
  deps.log.info(logLine("info", "push dispatcher armed", { seriesId: deps.seriesId }));
  return { stop: () => clearTimeout(timer), nextRunAt: () => next };
}

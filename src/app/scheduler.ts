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

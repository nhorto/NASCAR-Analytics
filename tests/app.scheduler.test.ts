// Weekly-refresh scheduler: next-slot math and the lock-protected run wrapper.
import { describe, expect, test } from "bun:test";
import {
  nextRefreshAt,
  nextDailyAt,
  nextWeeklyAt,
  startPredictionsScheduler,
  runScheduledRefresh,
  REFRESH_LOCK_NAME,
  REFRESH_LOCK_TTL_MS,
  pollAndDispatch,
  PUSH_POLL_IDLE_MS,
  PUSH_POLL_LIVE_MS,
} from "../src/app/scheduler.ts";
import { acquireLock } from "../src/providers/lock.ts";
import { testDb } from "./seed.ts";

const quiet = { info: () => {}, warn: () => {} };

describe("nextRefreshAt", () => {
  test("mid-week lands on the following Monday 12:00 UTC", () => {
    // Wed 2026-09-09 → Mon 2026-09-14.
    expect(nextRefreshAt(new Date("2026-09-09T08:00:00Z")).toISOString()).toBe(
      "2026-09-14T12:00:00.000Z",
    );
  });

  test("Monday before noon fires the same day", () => {
    expect(nextRefreshAt(new Date("2026-09-14T09:30:00Z")).toISOString()).toBe(
      "2026-09-14T12:00:00.000Z",
    );
  });

  test("Monday at exactly noon (or after) waits a week", () => {
    expect(nextRefreshAt(new Date("2026-09-14T12:00:00Z")).toISOString()).toBe(
      "2026-09-21T12:00:00.000Z",
    );
    expect(nextRefreshAt(new Date("2026-09-14T18:00:00Z")).toISOString()).toBe(
      "2026-09-21T12:00:00.000Z",
    );
  });

  test("Sunday rolls to the next day, across a month boundary", () => {
    // Sun 2026-11-01 → Mon 2026-11-02.
    expect(nextRefreshAt(new Date("2026-11-01T15:00:00Z")).toISOString()).toBe(
      "2026-11-02T12:00:00.000Z",
    );
  });
});

describe("nextDailyAt", () => {
  test("before the hour fires the same day, at/after it waits until tomorrow", () => {
    expect(nextDailyAt(new Date("2026-09-09T08:59:59Z"), 9).toISOString()).toBe(
      "2026-09-09T09:00:00.000Z",
    );
    expect(nextDailyAt(new Date("2026-09-09T09:00:00Z"), 9).toISOString()).toBe(
      "2026-09-10T09:00:00.000Z",
    );
    expect(nextDailyAt(new Date("2026-09-09T15:00:00Z"), 9).toISOString()).toBe(
      "2026-09-10T09:00:00.000Z",
    );
  });

  test("rolls across month and year boundaries", () => {
    expect(nextDailyAt(new Date("2026-09-30T10:00:00Z"), 9).toISOString()).toBe(
      "2026-10-01T09:00:00.000Z",
    );
    expect(nextDailyAt(new Date("2026-12-31T23:59:00Z"), 9).toISOString()).toBe(
      "2027-01-01T09:00:00.000Z",
    );
  });
});

describe("runScheduledRefresh", () => {
  test("runs under the lock and releases it afterwards", async () => {
    const db = testDb();
    let runs = 0;
    const outcome = await runScheduledRefresh({
      db,
      log: quiet,
      holder: "s1",
      runRefresh: async () => {
        runs += 1;
        // While running, another holder must be locked out.
        expect(acquireLock(db, REFRESH_LOCK_NAME, "other", REFRESH_LOCK_TTL_MS)).toBe(false);
        return 0;
      },
    });
    expect(outcome).toBe("ran");
    expect(runs).toBe(1);
    // Released: another holder can take it now.
    expect(acquireLock(db, REFRESH_LOCK_NAME, "other", REFRESH_LOCK_TTL_MS)).toBe(true);
  });

  test("skips (and does not run) when another holder has the lock", async () => {
    const db = testDb();
    expect(acquireLock(db, REFRESH_LOCK_NAME, "other", REFRESH_LOCK_TTL_MS)).toBe(true);
    let runs = 0;
    const outcome = await runScheduledRefresh({
      db,
      log: quiet,
      holder: "s1",
      runRefresh: async () => {
        runs += 1;
        return 0;
      },
    });
    expect(outcome).toBe("skipped-lock");
    expect(runs).toBe(0);
  });

  test("a non-zero exit is 'failed' and still releases the lock", async () => {
    const db = testDb();
    const outcome = await runScheduledRefresh({
      db,
      log: quiet,
      holder: "s1",
      runRefresh: async () => 1,
    });
    expect(outcome).toBe("failed");
    expect(acquireLock(db, REFRESH_LOCK_NAME, "other", REFRESH_LOCK_TTL_MS)).toBe(true);
  });

  test("a thrown refresh is 'failed' and still releases the lock", async () => {
    const db = testDb();
    const outcome = await runScheduledRefresh({
      db,
      log: quiet,
      holder: "s1",
      runRefresh: async () => {
        throw new Error("boom");
      },
    });
    expect(outcome).toBe("failed");
    expect(acquireLock(db, REFRESH_LOCK_NAME, "other", REFRESH_LOCK_TTL_MS)).toBe(true);
  });
});

describe("nextWeeklyAt (predictions crons, WS-F)", () => {
  // 2026-09-07 is a Monday.
  test("mid-week lands on the requested weekday and hour", () => {
    expect(nextWeeklyAt(new Date("2026-09-07T10:00:00Z"), 4, 16).toISOString()).toBe(
      "2026-09-10T16:00:00.000Z", // Thursday
    );
    expect(nextWeeklyAt(new Date("2026-09-07T10:00:00Z"), 6, 22).toISOString()).toBe(
      "2026-09-12T22:00:00.000Z", // Saturday
    );
  });

  test("on the day: before the hour fires today, at/after waits a week", () => {
    expect(nextWeeklyAt(new Date("2026-09-10T15:59:00Z"), 4, 16).toISOString()).toBe(
      "2026-09-10T16:00:00.000Z",
    );
    expect(nextWeeklyAt(new Date("2026-09-10T16:00:00Z"), 4, 16).toISOString()).toBe(
      "2026-09-17T16:00:00.000Z",
    );
  });

  test("rolls across month boundaries", () => {
    expect(nextWeeklyAt(new Date("2026-09-27T00:00:00Z"), 4, 16).toISOString()).toBe(
      "2026-10-01T16:00:00.000Z",
    );
  });
});

describe("startPredictionsScheduler", () => {
  test("arms both slots and reports the sooner one; failures only log", async () => {
    const ran: string[] = [];
    const warned: string[] = [];
    const scheduler = startPredictionsScheduler({
      log: { info: () => {}, warn: (m) => warned.push(m) },
      runPredict: async (stage) => {
        ran.push(stage);
        return stage === "saturday" ? 1 : 0; // saturday "fails"
      },
      now: () => new Date("2026-09-07T10:00:00Z").getTime(),
    });
    try {
      // Monday → Thursday slot is nearer than Saturday.
      expect(scheduler.nextRunAt().toISOString()).toBe("2026-09-10T16:00:00.000Z");
    } finally {
      scheduler.stop();
    }
    expect(ran).toEqual([]); // nothing fires synchronously
  });
});

// --- race-day push dispatcher (WS-H) ---

describe("push dispatcher polling", () => {
  const log = { info: () => {}, warn: () => {} };
  const base = "https://live.example.workers.dev";

  function payload(over: Record<string, unknown> = {}) {
    return {
      ok: true,
      live: true,
      snapshot: { raceId: 5555, runName: "Southern 500", trackName: "Darlington", lap: 120 },
      alerts: [{ kind: "pit", message: "Bell pits", driverId: 10, atLap: 120 }],
      ...over,
    };
  }

  function deps(over: Record<string, unknown> = {}) {
    const dispatched: unknown[] = [];
    return {
      dispatched,
      deps: {
        p: { db: testDb() },
        liveApiBase: base,
        seriesId: 1,
        vapid: { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" },
        log,
        dispatch: (async (_p: unknown, alerts: unknown[]) => {
          dispatched.push(...alerts);
          return { considered: alerts.length, sent: alerts.length, skippedDuplicate: 0, skippedFiltered: 0, failed: 0, pruned: 0 };
        }) as never,
        ...over,
      } as never,
    };
  }

  test("dispatches the Worker's alerts and polls fast while racing", async () => {
    const { deps: d, dispatched } = deps({
      fetchImpl: async () => new Response(JSON.stringify(payload())),
    });
    const result = await pollAndDispatch(d, false);
    expect(result.live).toBe(true);
    expect(result.sent).toBe(1);
    expect(result.nextDelayMs).toBe(PUSH_POLL_LIVE_MS);
    expect(dispatched).toEqual([
      { kind: "pit", message: "Bell pits", driverId: 10, atLap: 120, raceId: 5555 },
    ]);
  });

  test("backs off to the idle interval when no session is on track", async () => {
    const { deps: d } = deps({
      fetchImpl: async () => new Response(JSON.stringify(payload({ live: false, alerts: [] }))),
    });
    const result = await pollAndDispatch(d, false);
    expect(result.live).toBe(false);
    expect(result.nextDelayMs).toBe(PUSH_POLL_IDLE_MS);
  });

  test("synthesizes a finish alert on the live-to-idle transition", async () => {
    // The checkered flag isn't a snapshot diff, so it has to be inferred.
    const { deps: d, dispatched } = deps({
      fetchImpl: async () => new Response(JSON.stringify(payload({ live: false, alerts: [] }))),
    });
    await pollAndDispatch(d, true);
    expect(dispatched).toEqual([
      { kind: "finish", message: "Southern 500 is complete", driverId: null, atLap: 120, raceId: 5555 },
    ]);
  });

  test("a finish is not re-synthesized while the session stays idle", async () => {
    const { deps: d, dispatched } = deps({
      fetchImpl: async () => new Response(JSON.stringify(payload({ live: false, alerts: [] }))),
    });
    await pollAndDispatch(d, false); // already idle last time
    expect(dispatched).toEqual([]);
  });

  test("an unreachable or erroring Worker backs off instead of throwing", async () => {
    const down = deps({ fetchImpl: async () => { throw new Error("network down"); } });
    await expect(pollAndDispatch(down.deps, true)).resolves.toMatchObject({
      live: false, sent: 0, nextDelayMs: PUSH_POLL_IDLE_MS,
    });

    const err = deps({ fetchImpl: async () => new Response("nope", { status: 502 }) });
    await expect(pollAndDispatch(err.deps, true)).resolves.toMatchObject({ live: false, sent: 0 });

    const junk = deps({ fetchImpl: async () => new Response("not json") });
    await expect(pollAndDispatch(junk.deps, true)).resolves.toMatchObject({ live: false, sent: 0 });
  });

  test("a payload the Worker marks not-ok is ignored", async () => {
    const { deps: d, dispatched } = deps({
      fetchImpl: async () => new Response(JSON.stringify({ ok: false })),
    });
    const result = await pollAndDispatch(d, true);
    expect(result.sent).toBe(0);
    expect(dispatched).toEqual([]);
  });
});

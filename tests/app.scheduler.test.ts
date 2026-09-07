// Weekly-refresh scheduler: next-slot math and the lock-protected run wrapper.
import { describe, expect, test } from "bun:test";
import {
  nextRefreshAt,
  nextDailyAt,
  runScheduledRefresh,
  REFRESH_LOCK_NAME,
  REFRESH_LOCK_TTL_MS,
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

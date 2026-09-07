// End-to-end ingestion against an in-memory DB with a fake CDN serving the
// real-data fixtures. Verifies orchestration, idempotent skip, and coverage.
import { describe, expect, test } from "bun:test";
import { createDb, createNullArchive, type Providers, type CdnFetchResult } from "../src/providers/index.ts";
import { backfill, coverage } from "../src/domains/data-ingestion/service.ts";
import {
  scheduleUrl,
  weekendFeedUrl,
  lapTimesUrl,
  loopStatsUrl,
  SERIES,
} from "../src/domains/data-ingestion/config.ts";
import scheduleFixture from "./fixtures/schedule-feed.json";
import weekendFixture from "./fixtures/weekend-feed.json";
import lapTimesFixture from "./fixtures/lap-times.json";
import loopStatsFixture from "./fixtures/loopstats.json";

const NOW = "2026-07-05T00:00:00.000Z";
const silentLog = { info: () => {}, warn: () => {} };

function fakeProviders(
  overrides?: Map<string, unknown>,
): { providers: Providers; requests: Map<string, number> } {
  const routes = new Map<string, unknown>([
    [scheduleUrl(2026, SERIES.cup), scheduleFixture],
    [weekendFeedUrl(2026, SERIES.cup, 5617), weekendFixture],
    [lapTimesUrl(2026, SERIES.cup, 5617), lapTimesFixture],
    [loopStatsUrl(2026, SERIES.cup, 5617), loopStatsFixture],
    ...(overrides ?? []),
  ]);
  const requests = new Map<string, number>();
  const providers: Providers = {
    db: createDb(":memory:"),
    archive: createNullArchive(),
    cdn: {
      async fetchJson(url: string): Promise<CdnFetchResult> {
        requests.set(url, (requests.get(url) ?? 0) + 1);
        const json = routes.get(url);
        if (json === undefined) return { url, status: 403, body: null, json: null };
        return { url, status: 200, body: JSON.stringify(json), json };
      },
    },
  };
  return { providers, requests };
}

const OPTS = { fromSeason: 2026, toSeason: 2026, seriesId: SERIES.cup, nowUtc: NOW };

describe("backfill", () => {
  test("ingests completed races, skips future races", async () => {
    const { providers } = fakeProviders();
    await backfill(providers, OPTS, silentLog);
    const db = providers.db;

    // Race 5617 (June 28) fully ingested; 5601 (November) is a shell only.
    expect(db.query("SELECT COUNT(*) AS n FROM races").get()).toEqual({ n: 2 });
    expect(db.query("SELECT COUNT(*) AS n FROM results WHERE race_id = 5617").get()).toEqual({ n: 3 });
    expect(db.query("SELECT COUNT(*) AS n FROM results WHERE race_id = 5601").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM loop_stats").get()).toEqual({ n: 2 });
    expect(db.query("SELECT COUNT(*) AS n FROM lap_times").get()).toEqual({ n: 8 });
    expect(db.query("SELECT COUNT(*) AS n FROM cautions").get()).toEqual({ n: 2 });
    expect(db.query("SELECT COUNT(*) AS n FROM race_leaders").get()).toEqual({ n: 2 });

    // Weekend-feed enrichment landed on the race row.
    const race = db
      .query("SELECT track_type, actual_laps, cautions FROM races WHERE race_id = 5617")
      .get() as { track_type: string; actual_laps: number; cautions: number };
    expect(race.track_type).toBe("road");
    expect(race.actual_laps).toBe(110);
    expect(race.cautions).toBe(3);

    // Winner cross-check: weekend-feed winner matches loop stats finish position 1.
    const winner = db
      .query(
        `SELECT r.driver_id AS resultWinner,
                (SELECT driver_id FROM loop_stats WHERE race_id = 5617 AND finish_ps = 1) AS loopWinner
         FROM results r WHERE r.race_id = 5617 AND r.finishing_position = 1`,
      )
      .get() as { resultWinner: number; loopWinner: number };
    expect(winner.resultWinner).toBe(winner.loopWinner);

    // Raw fetches recorded for every request (1 schedule + 3 per-race feeds).
    expect(db.query("SELECT COUNT(*) AS n FROM raw_fetches").get()).toEqual({ n: 4 });
  });

  test("re-running skips already-covered races", async () => {
    const { providers, requests } = fakeProviders();
    await backfill(providers, OPTS, silentLog);
    await backfill(providers, OPTS, silentLog);

    // Schedule refetched each run; per-race feeds fetched exactly once.
    expect(requests.get(scheduleUrl(2026, SERIES.cup))).toBe(2);
    expect(requests.get(weekendFeedUrl(2026, SERIES.cup, 5617))).toBe(1);
    expect(requests.get(lapTimesUrl(2026, SERIES.cup, 5617))).toBe(1);
    expect(requests.get(loopStatsUrl(2026, SERIES.cup, 5617))).toBe(1);

    // Data is unchanged (upserts are idempotent).
    expect(providers.db.query("SELECT COUNT(*) AS n FROM results").get()).toEqual({ n: 3 });
    expect(providers.db.query("SELECT COUNT(*) AS n FROM lap_times").get()).toEqual({ n: 8 });
  });

  test("force re-ingests covered races without duplicating rows", async () => {
    const { providers, requests } = fakeProviders();
    await backfill(providers, OPTS, silentLog);
    await backfill(providers, { ...OPTS, force: true }, silentLog);

    expect(requests.get(weekendFeedUrl(2026, SERIES.cup, 5617))).toBe(2);
    expect(providers.db.query("SELECT COUNT(*) AS n FROM results").get()).toEqual({ n: 3 });
    expect(providers.db.query("SELECT COUNT(*) AS n FROM cautions").get()).toEqual({ n: 2 });
    expect(providers.db.query("SELECT COUNT(*) AS n FROM lap_times").get()).toEqual({ n: 8 });
  });

  test("a mid-race write failure rolls back the WHOLE race (WS-C invariant)", async () => {
    // Corrupt the weekend feed so the results upsert hits a NOT NULL constraint
    // partway through the per-race transaction.
    const corrupt = structuredClone(weekendFixture) as typeof weekendFixture;
    (corrupt.weekend_race[0]!.results[1] as { finishing_position: number | null }).finishing_position = null;
    const { providers } = fakeProviders(
      new Map([[weekendFeedUrl(2026, SERIES.cup, 5617), corrupt]]),
    );
    const warnings: string[] = [];
    await backfill(providers, OPTS, { info: () => {}, warn: (m) => warnings.push(m) });
    const db = providers.db;

    // Nothing from the race landed — not even the parts that would have
    // succeeded on their own (drivers, loop stats, lap times, race enrichment).
    expect(db.query("SELECT COUNT(*) AS n FROM results").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM drivers").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM loop_stats").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM lap_times").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM cautions").get()).toEqual({ n: 0 });
    const race = db
      .query("SELECT actual_laps AS actualLaps FROM races WHERE race_id = 5617")
      .get() as { actualLaps: number | null };
    expect(race.actualLaps).toBeNull(); // schedule shell survives, enrichment rolled back

    // The backfill did NOT crash: the failure was logged and the loop continued.
    expect(warnings.some((w) => w.includes("rolled back"))).toBe(true);
    expect(warnings.some((w) => w.includes("FAILED") || w.includes("ingest failed"))).toBe(true);
  });

  test("the failed race is retried (not marked covered) on the next run", async () => {
    const corrupt = structuredClone(weekendFixture) as typeof weekendFixture;
    (corrupt.weekend_race[0]!.results[1] as { finishing_position: number | null }).finishing_position = null;
    const bad = fakeProviders(new Map([[weekendFeedUrl(2026, SERIES.cup, 5617), corrupt]]));
    await backfill(bad.providers, OPTS, silentLog);
    expect(bad.requests.get(weekendFeedUrl(2026, SERIES.cup, 5617))).toBe(1);
    // Second run with the same (still corrupt) feed: the race was not counted
    // as covered, so it fetches again.
    await backfill(bad.providers, OPTS, silentLog);
    expect(bad.requests.get(weekendFeedUrl(2026, SERIES.cup, 5617))).toBe(2);
  });

  test("coverage reports per-season completeness", async () => {
    const { providers } = fakeProviders();
    await backfill(providers, OPTS, silentLog);
    const rows = coverage(providers, SERIES.cup);
    expect(rows).toEqual([
      {
        season: 2026,
        scheduledRaces: 2,
        racesWithResults: 1,
        racesWithLoopStats: 1,
        racesWithLapTimes: 1,
      },
    ]);
  });
});

// End-to-end: seed the real schema, run computeAll, read back computed tables.
import { describe, expect, test } from "bun:test";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop } from "./seed.ts";

function seedScenario() {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedDriver(db, 20, "Beta Driver");

  seedRace(db, { raceId: 100, season: 2024, raceDateUtc: "2024-03-01T18:00:00" });
  seedRace(db, { raceId: 101, season: 2024, trackType: "road", raceDateUtc: "2024-03-08T18:00:00" });
  // Exhibition — must be excluded from analytics entirely.
  seedRace(db, { raceId: 999, season: 2024, raceTypeId: 2, raceDateUtc: "2024-02-01T18:00:00" });
  // The YellaWood-500 shape: NULL race_type_id but present in POINTS_RACE_ID_OVERRIDES,
  // loop stats only (no results).
  seedRace(db, { raceId: 5580, season: 2024, raceTypeId: null, raceDateUtc: "2024-10-05T18:00:00" });

  seedResult(db, { raceId: 100, driverId: 10, finish: 1, start: 3, lapsLed: 100, points: 55 });
  seedResult(db, { raceId: 100, driverId: 20, finish: 15, start: 10, points: 22 });
  seedResult(db, { raceId: 101, driverId: 10, finish: 8, start: 4, points: 29 });
  seedResult(db, { raceId: 101, driverId: 20, finish: 30, start: 25, status: "Engine", points: 7 });
  seedResult(db, { raceId: 999, driverId: 10, finish: 1, points: 0 });

  seedLoop(db, { raceId: 100, driverId: 10, avgPs: 2, passesGf: 6, passedGf: 2, closingPs: 2, closingLapsDiff: 1, rating: 130 });
  seedLoop(db, { raceId: 100, driverId: 20, avgPs: 14, passesGf: 10, passedGf: 12, closingPs: 14, closingLapsDiff: -1, rating: 70 });
  seedLoop(db, { raceId: 5580, driverId: 10, avgPs: 5, rating: 100 });
  return db;
}

describe("computeAll", () => {
  test("computes and persists season, track-type, and form rows", () => {
    const db = seedScenario();
    const summary = analyticsService.computeAll({ db });

    // Exhibition race 999 excluded; override race 5580 loop row included.
    expect(summary.resultRows).toBe(4);
    expect(summary.loopRows).toBe(3);

    const d10 = analyticsService.seasonStatsForDriver({ db }, 10);
    expect(d10).toHaveLength(1);
    expect(d10[0]!.races).toBe(2); // race 999 (exhibition) not counted
    expect(d10[0]!.wins).toBe(1);
    expect(d10[0]!.points).toBe(55 + 29);
    expect(d10[0]!.loopRaces).toBe(2); // includes override race 5580
    expect(d10[0]!.avgRating).toBeCloseTo((130 + 100) / 2);

    const d20 = analyticsService.seasonStatsForDriver({ db }, 20);
    expect(d20[0]!.dnfs).toBe(1);
    expect(d20[0]!.avgFinish).toBeCloseTo((15 + 30) / 2);

    const tt = analyticsService.trackTypeStatsForDriver({ db }, 10);
    const types = tt.map((t) => t.trackType).sort();
    expect(types).toEqual(["intermediate", "road"]);
    expect(tt.find((t) => t.trackType === "road")!.races).toBe(1);

    const form = analyticsService.formForDriver({ db }, 10);
    expect(form).toHaveLength(2); // form is keyed off results participation
    expect(form[0]!.windowRaces).toBe(1);
    expect(form[1]!.windowRaces).toBe(2);
    expect(form[1]!.avgFinish).toBeCloseTo((1 + 8) / 2);
  });

  test("recompute is idempotent — no duplicate rows", () => {
    const db = seedScenario();
    analyticsService.computeAll({ db });
    const first = db.query(`SELECT COUNT(*) AS n FROM driver_season_stats`).get() as { n: number };
    analyticsService.computeAll({ db });
    const second = db.query(`SELECT COUNT(*) AS n FROM driver_season_stats`).get() as { n: number };
    expect(second.n).toBe(first.n);
    const form = db.query(`SELECT COUNT(*) AS n FROM driver_form`).get() as { n: number };
    expect(form.n).toBe(4);
  });

  test("leaderboard read orders by wins", () => {
    const db = seedScenario();
    analyticsService.computeAll({ db });
    const board = analyticsService.seasonLeaderboard({ db }, 2024);
    expect(board[0]!.driverId).toBe(10);
  });

  test("formLeaders excludes elite part-timers who ran too few of the season", () => {
    const db = testDb();
    seedDriver(db, 1, "Regular Runner");
    seedDriver(db, 2, "Part Timer");
    // 10-race season, one race per day so dates order cleanly.
    for (let i = 1; i <= 10; i++) {
      seedRace(db, {
        raceId: 100 + i,
        season: 2024,
        raceDateUtc: `2024-03-${String(10 + i).padStart(2, "0")}T18:00:00`,
        raceName: `R${i}`,
      });
      seedResult(db, { raceId: 100 + i, driverId: 1, finish: 10, points: 20 }); // regular: all 10, mediocre
    }
    // Part-timer: 4 starts incl. the finale (race 110), all P1 — passes the
    // window_races >= 4 gate and ran the latest race, but 4/10 = 0.4 < 0.5 share.
    for (const rid of [101, 102, 103, 110]) {
      seedResult(db, { raceId: rid, driverId: 2, finish: 1, points: 40 });
    }
    analyticsService.computeAll({ db });
    const ids = analyticsService.formLeaders({ db }, 10).map((l) => l.driverId);
    expect(ids).toContain(1); // the regular
    expect(ids).not.toContain(2); // the elite part-timer
  });
});

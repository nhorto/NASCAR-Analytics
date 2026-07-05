import { describe, expect, test } from "bun:test";
import { driversService } from "../src/domains/drivers/index.ts";
import type { CareerSeasonRow } from "../src/domains/drivers/types.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop } from "./seed.ts";

function seedScenario() {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedDriver(db, 20, "Beta Racer");

  seedRace(db, { raceId: 100, season: 2023, raceDateUtc: "2023-03-01T18:00:00" });
  seedRace(db, { raceId: 101, season: 2024, raceDateUtc: "2024-03-08T18:00:00" });
  seedRace(db, { raceId: 999, season: 2024, raceTypeId: 2, raceDateUtc: "2024-02-01T18:00:00" });

  seedResult(db, { raceId: 100, driverId: 10, finish: 1, teamName: "Old Team", carNumber: "9" });
  seedResult(db, { raceId: 101, driverId: 10, finish: 5, teamName: "New Team", carNumber: "9" });
  seedResult(db, { raceId: 999, driverId: 10, finish: 1, teamName: "New Team", carNumber: "9" });
  seedResult(db, { raceId: 101, driverId: 20, finish: 12, teamName: "Beta Team", carNumber: "48" });
  seedLoop(db, { raceId: 101, driverId: 10, avgPs: 4, rating: 105 });
  return db;
}

describe("driversService", () => {
  test("summaries count points races only and carry the latest team", () => {
    const db = seedScenario();
    const idx = driversService.driverIndex({ db });
    const alpha = idx.find((d) => d.driverId === 10)!;
    expect(alpha.races).toBe(2); // exhibition 999 not counted
    expect(alpha.wins).toBe(1);
    expect(alpha.firstSeason).toBe(2023);
    expect(alpha.lastSeason).toBe(2024);
    expect(alpha.latestTeam).toBe("New Team");
    expect(alpha.latestCarNumber).toBe("9");
  });

  test("findDriver matches id, exact name, and partial name case-insensitively", () => {
    const db = seedScenario();
    expect(driversService.findDriver({ db }, 20)!.fullName).toBe("Beta Racer");
    expect(driversService.findDriver({ db }, "alpha driver")!.driverId).toBe(10);
    expect(driversService.findDriver({ db }, "beta")!.driverId).toBe(20);
    expect(driversService.findDriver({ db }, "nobody")).toBeNull();
  });

  test("race log includes exhibitions, newest first, with loop rating when present", () => {
    const db = seedScenario();
    const log = driversService.driverRaceLog({ db }, 10);
    expect(log).toHaveLength(3);
    expect(log.map((e) => e.raceId)).toEqual([101, 999, 100]);
    expect(log[0]!.rating).toBeCloseTo(105);
    expect(log[2]!.rating).toBeNull();
    expect(log[0]!.disqualified).toBe(false);
  });

  test("identityIssues flags one name under two ids", () => {
    const db = seedScenario();
    expect(driversService.identityIssues({ db })).toEqual([]);
    seedDriver(db, 30, "Alpha Driver");
    const issues = driversService.identityIssues({ db });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.driverIds.sort()).toEqual([10, 30]);
  });
});

describe("summariseSeries", () => {
  const rows: CareerSeasonRow[] = [
    { seriesId: 2, season: 2019, races: 10, wins: 2, top5s: 5, top10s: 8, avgFinish: 12 },
    { seriesId: 1, season: 2020, races: 20, wins: 1, top5s: 6, top10s: 12, avgFinish: 15 },
    { seriesId: 1, season: 2021, races: 30, wins: 4, top5s: 10, top10s: 20, avgFinish: 10 },
  ];

  test("groups by series, sums totals, orders by series id", () => {
    const s = driversService.summariseSeries(rows);
    expect(s.map((x) => x.seriesId)).toEqual([1, 2]);
    const cup = s[0]!;
    expect(cup.races).toBe(50);
    expect(cup.wins).toBe(5);
    expect(cup.seasons).toBe(2);
    expect(cup.firstSeason).toBe(2020);
    expect(cup.lastSeason).toBe(2021);
    // races-weighted avg finish: (15*20 + 10*30) / 50 = 12
    expect(cup.avgFinish).toBeCloseTo(12);
  });

  test("empty input yields no summaries", () => {
    expect(driversService.summariseSeries([])).toEqual([]);
  });
});

describe("driverCareer", () => {
  test("spans series with a newest-first season matrix; null for unknown driver", () => {
    const db = testDb();
    seedDriver(db, 10, "Dual Series");
    // Cup 2024 + Xfinity 2023, and one exhibition that must be excluded.
    seedRace(db, { raceId: 1, season: 2024, seriesId: 1, raceDateUtc: "2024-05-01T18:00:00" });
    seedRace(db, { raceId: 2, season: 2023, seriesId: 2, raceDateUtc: "2023-05-01T18:00:00" });
    seedRace(db, { raceId: 3, season: 2024, seriesId: 1, raceTypeId: 2, raceDateUtc: "2024-06-01T18:00:00" });
    seedResult(db, { raceId: 1, driverId: 10, finish: 1, teamName: "Cup Team", carNumber: "5" });
    seedResult(db, { raceId: 2, driverId: 10, finish: 3, teamName: "Xf Team", carNumber: "9" });
    seedResult(db, { raceId: 3, driverId: 10, finish: 1, teamName: "Cup Team", carNumber: "5" });

    const career = driversService.driverCareer({ db }, 10)!;
    expect(career.fullName).toBe("Dual Series");
    expect(career.firstSeason).toBe(2023);
    expect(career.lastSeason).toBe(2024);
    expect(career.series.map((s) => s.seriesId)).toEqual([1, 2]);
    // Exhibition race 3 excluded → Cup has 1 start, 1 win.
    expect(career.series[0]!.races).toBe(1);
    expect(career.series[0]!.wins).toBe(1);
    // Latest ride is the most recent points start (Cup 2024).
    expect(career.latestTeam).toBe("Cup Team");
    // Season matrix newest-first.
    expect(career.seasons.map((r) => r.season)).toEqual([2024, 2023]);

    expect(driversService.driverCareer({ db }, 999)).toBeNull();
  });
});

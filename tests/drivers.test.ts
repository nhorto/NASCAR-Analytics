import { describe, expect, test } from "bun:test";
import { driversService } from "../src/domains/drivers/index.ts";
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

// Predictions domain: deterministic PRNG/simulation, feature windows, rating
// composition, allocation math, DFS scoring (hand-computed per rule —
// launch-plan acceptance), scoring-config validation negatives, and the
// point-in-time leakage guard + generate flow over a seeded db.
import { describe, expect, test } from "bun:test";
import { predictionsService as svc, type PriorRaceRow, type ScoringRules } from "../src/domains/predictions/index.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop } from "./seed.ts";

function prior(over: Partial<PriorRaceRow>): PriorRaceRow {
  return {
    raceId: 1, raceDateUtc: "2026-01-01", trackType: "intermediate", finish: 10,
    start: 10, dnf: false, rating: null, lapsLed: 0, fastLaps: null, raceLaps: 300,
    ...over,
  };
}

describe("randomness", () => {
  test("mulberry32 is deterministic and uniform-ish", () => {
    const a = svc.mulberry32(42);
    const b = svc.mulberry32(42);
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(svc.mulberry32(43)()).not.toBe(svc.mulberry32(42)());
    const rng = svc.mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 5000; i++) sum += rng();
    expect(sum / 5000).toBeGreaterThan(0.47);
    expect(sum / 5000).toBeLessThan(0.53);
  });
});

describe("features", () => {
  test("windows: trailing-5 finish, track-type filter, DNF share", () => {
    const rows = [
      prior({ finish: 1 }), prior({ finish: 2 }), prior({ finish: 3 }),
      prior({ finish: 4 }), prior({ finish: 5 }),
      prior({ finish: 40, trackType: "road", dnf: true }), // outside trailing-5
    ];
    const f = svc.buildFeatures(1, "A", rows, "road", null);
    expect(f.trailingFinish).toBe(3); // (1+2+3+4+5)/5
    expect(f.trackTypeFinish).toBe(40); // only the road race
    expect(f.dnfRate).toBeCloseTo(1 / 6, 5);
    expect(f.priorStarts).toBe(6);
  });

  test("no history yields nulls and zero rates, not NaN", () => {
    const f = svc.buildFeatures(1, "Rookie", [], "short", null);
    expect(f.trailingFinish).toBeNull();
    expect(f.trailingRating).toBeNull();
    expect(f.trackTypeFinish).toBeNull();
    expect(f.dnfRate).toBe(0);
    expect(f.lapsLedShare).toBe(0);
  });

  test("laps-led share uses only races with a known lap count", () => {
    const rows = [
      prior({ lapsLed: 150, raceLaps: 300 }),
      prior({ lapsLed: 999, raceLaps: null }), // must be ignored
    ];
    expect(svc.buildFeatures(1, "A", rows, "intermediate", null).lapsLedShare).toBe(0.5);
  });
});

describe("rating", () => {
  const W = { trailingFinish: 0.5, trackTypeFinish: 0.5, loopRating: 0, startPos: 0, dnfPenalty: 10 };

  test("weighted average with renormalization when components are missing", () => {
    const both = svc.buildFeatures(1, "A", [prior({ finish: 4 })], "intermediate", null);
    expect(svc.ratingFor(both, W)).toBe(4); // both components = 4, dnf 0
    const f = svc.buildFeatures(1, "A", [prior({ finish: 6, trackType: "road" })], "short", null);
    // trackTypeFinish missing → all weight on trailingFinish
    expect(svc.ratingFor(f, W)).toBe(6);
  });

  test("no usable components falls back to the rookie finish", () => {
    const f = svc.buildFeatures(1, "Rookie", [], "short", null);
    expect(svc.ratingFor(f, W)).toBe(22);
  });

  test("DNF rate adds a penalty; better form means a better rating", () => {
    const clean = svc.buildFeatures(1, "A", [prior({ finish: 5 })], "intermediate", null);
    const crasher = svc.buildFeatures(1, "B", [prior({ finish: 5, dnf: true })], "intermediate", null);
    expect(svc.ratingFor(crasher, W)).toBe(svc.ratingFor(clean, W) + 10);
    const better = svc.buildFeatures(1, "C", [prior({ finish: 2 })], "intermediate", null);
    expect(svc.ratingFor(better, W)).toBeLessThan(svc.ratingFor(clean, W));
  });
});

describe("simulation", () => {
  const entries = [
    { driverId: 1, rating: 5, extraSigma: 0 },
    { driverId: 2, rating: 10, extraSigma: 0 },
    { driverId: 3, rating: 15, extraSigma: 0 },
    { driverId: 4, rating: 25, extraSigma: 0 },
  ];

  test("probabilities are coherent: pWin sums to 1, ordering follows ratings", () => {
    const out = svc.simulateField(entries, 8, 4000, 99);
    const pWinSum = [...out.values()].reduce((a, o) => a + o.pWin, 0);
    expect(pWinSum).toBeCloseTo(1, 10);
    expect(out.get(1)!.pWin).toBeGreaterThan(out.get(2)!.pWin);
    expect(out.get(2)!.pWin).toBeGreaterThan(out.get(4)!.pWin);
    expect(out.get(1)!.expFinish).toBeLessThan(out.get(4)!.expFinish);
    // Fields smaller than K make top-K certain.
    expect(out.get(4)!.pTop5).toBe(1);
  });

  test("same seed reproduces exactly; different seed varies", () => {
    const a = svc.simulateField(entries, 8, 1000, 7);
    const b = svc.simulateField(entries, 8, 1000, 7);
    const c = svc.simulateField(entries, 8, 1000, 8);
    expect(a.get(1)!.pWin).toBe(b.get(1)!.pWin);
    expect(a.get(1)!.pWin).not.toBe(c.get(1)!.pWin);
  });
});

describe("allocation", () => {
  test("allocations sum to the total and follow the blend", () => {
    const out = svc.allocateTotal(
      [
        { driverId: 1, priorShare: 0.5, simOdds: 0.5 },
        { driverId: 2, priorShare: 0, simOdds: 0.5 },
      ],
      100, 0.6,
    );
    expect(out.get(1)! + out.get(2)!).toBeCloseTo(100, 8);
    expect(out.get(1)!).toBeCloseTo(80, 8); // 0.6·1.0 + 0.4·0.5 vs 0.4·0.5
  });

  test("no signal at all splits evenly", () => {
    const out = svc.allocateTotal(
      [
        { driverId: 1, priorShare: 0, simOdds: 0 },
        { driverId: 2, priorShare: 0, simOdds: 0 },
      ],
      50, 0.6,
    );
    expect(out.get(1)!).toBeCloseTo(25, 8);
  });
});

describe("DFS scoring (acceptance: hand-computed per rule)", () => {
  const dk: ScoringRules = {
    platform: "dk",
    finishPoints: [45, 42, 41, 40, 39, 38, 37, 36, 35, 34, ...Array.from({ length: 30 }, (_, i) => 32 - i)],
    lapLedPoints: 0.25, fastLapPoints: 0.45, placeDiffPoints: 1,
  };
  const fd: ScoringRules = {
    platform: "fd",
    finishPoints: [43, 40, 38, ...Array.from({ length: 37 }, (_, i) => 37 - i)],
    lapLedPoints: 0.1, fastLapPoints: 0, placeDiffPoints: 0.5,
  };

  test("DK: P1 from P5 with 100 led and 40 fastest = 45 + 25 + 18 + 4 = 92", () => {
    expect(svc.scoreDfs({ expFinish: 1, expLapsLed: 100, expFastLaps: 40 }, 5, dk)).toBe(92);
  });

  test("FD: P1 from P5 with 100 led (no fast-lap points) = 43 + 10 + 2 = 55", () => {
    expect(svc.scoreDfs({ expFinish: 1, expLapsLed: 100, expFastLaps: 40 }, 5, fd)).toBe(55);
  });

  test("fractional expected finishes interpolate; beyond the table is 0", () => {
    expect(svc.finishPointsFor(1.5, dk)).toBe((45 + 42) / 2);
    expect(svc.finishPointsFor(41, dk)).toBe(0);
    expect(svc.finishPointsFor(40.5, dk)).toBe(1.5); // half of P40's 3... table[39]=3
  });

  test("negative place differential subtracts", () => {
    // P10 from P2: 34 + 0 + 0 + (2-10)·1 = 26
    expect(svc.scoreDfs({ expFinish: 10, expLapsLed: 0, expFastLaps: 0 }, 2, dk)).toBe(26);
  });

  test("malformed scoring configs are rejected with the exact problem", () => {
    expect(() => svc.parseScoringRules(null, "x.json")).toThrow(/not an object/);
    expect(() => svc.parseScoringRules({ platform: "dk", finishPoints: [1, 2] }, "x.json")).toThrow(/≥30 positions/);
    expect(() =>
      svc.parseScoringRules({ platform: "dk", finishPoints: Array(40).fill(1), lapLedPoints: "no" }, "x.json"),
    ).toThrow(/lapLedPoints/);
  });
});

describe("generate flow (seeded db)", () => {
  function seedSeason(db: ReturnType<typeof testDb>) {
    for (const [id, name] of [[1, "Ace Driver"], [2, "Mid Driver"], [3, "Back Driver"]] as const)
      seedDriver(db, id, name);
    // Five completed races, then race 200 upcoming (race_type_id NULL like a
    // real future schedule row).
    for (let i = 0; i < 5; i++) {
      const raceId = 100 + i;
      seedRace(db, { raceId, season: 2026, raceDateUtc: `2026-05-0${i + 1}T18:00:00` });
      seedResult(db, { raceId, driverId: 1, finish: 1 + (i % 2), start: 2, lapsLed: 60 });
      seedResult(db, { raceId, driverId: 2, finish: 10, start: 12 });
      seedResult(db, { raceId, driverId: 3, finish: 25, start: 20, status: i === 0 ? "Accident" : "Running" });
      seedLoop(db, { raceId, driverId: 1, avgPs: 2, rating: 130, fastLaps: 20 });
      seedLoop(db, { raceId, driverId: 2, avgPs: 10, rating: 85 });
      seedLoop(db, { raceId, driverId: 3, avgPs: 22, rating: 45 });
    }
    seedRace(db, { raceId: 200, season: 2026, raceTypeId: null, raceDateUtc: "2026-06-10T18:00:00" });
    db.query(`UPDATE races SET scheduled_laps = 200 WHERE race_id = 200`).run();
    return { db };
  }

  test("nextRaceWithoutResults finds the future NULL-type race", () => {
    const p = seedSeason(testDb());
    expect(svc.nextRaceWithoutResults(p, 1, "2026-06-01T00:00:00Z")?.raceId).toBe(200);
  });

  test("generates, persists, and orders sensibly; runs are reproducible", () => {
    const p = seedSeason(testDb());
    const { run } = svc.generatePredictions(p, { raceId: 200, stage: "thursday", now: new Date("2026-06-08T12:00:00Z") });
    expect(run.predictions.length).toBe(3); // entry heuristic: last 3 races
    expect(run.basisRaceId).toBe(104);
    expect(run.predictions[0]!.fullName).toBe("Ace Driver");
    expect(run.predictions.at(-1)!.fullName).toBe("Back Driver");
    const pWinSum = run.predictions.reduce((a, d) => a + d.pWin, 0);
    expect(pWinSum).toBeCloseTo(1, 10);
    const lapsSum = run.predictions.reduce((a, d) => a + d.expLapsLed, 0);
    expect(lapsSum).toBeCloseTo(200, 6); // scheduled_laps allocated fully

    const again = svc.generatePredictions(p, { raceId: 200, stage: "thursday" });
    expect(again.run.predictions[0]!.pWin).toBe(run.predictions[0]!.pWin); // seeded by (race, stage)

    const stored = svc.latestPredictions(p, 200);
    expect(stored?.stage).toBe("thursday");
    expect(stored?.rows.length).toBe(3);
  });

  test("saturday grid moves the rating; projections score both platforms", () => {
    const p = seedSeason(testDb());
    const rules: ScoringRules[] = [
      { platform: "dk", finishPoints: Array.from({ length: 40 }, (_, i) => 45 - i), lapLedPoints: 0.25, fastLapPoints: 0.45, placeDiffPoints: 1 },
      { platform: "fd", finishPoints: Array.from({ length: 40 }, (_, i) => 43 - i), lapLedPoints: 0.1, fastLapPoints: 0, placeDiffPoints: 0.5 },
    ];
    const thursday = svc.generatePredictions(p, { raceId: 200, stage: "thursday", scoringRules: rules });
    // A pole start for the mid-pack driver should pull his rating forward.
    const saturday = svc.generatePredictions(p, {
      raceId: 200, stage: "saturday", scoringRules: rules,
      startPositions: new Map([[1, 5], [2, 1], [3, 30]]),
    });
    const midThu = thursday.run.predictions.find((d) => d.driverId === 2)!;
    const midSat = saturday.run.predictions.find((d) => d.driverId === 2)!;
    expect(midSat.rating).toBeLessThan(midThu.rating);
    expect(midSat.startPos).toBe(1);

    expect(saturday.projections.length).toBe(6); // 3 drivers × 2 platforms
    expect(svc.latestProjections(p, 200, "fd").length).toBe(3);
    // The stored latest stage is now saturday.
    expect(svc.latestPredictions(p, 200)?.stage).toBe("saturday");
  });

  test("leakage guard: the target race's own results never enter features", () => {
    const p = seedSeason(testDb());
    // Give race 200 results wildly contradicting history: Ace finishes last.
    seedResult(p.db, { raceId: 200, driverId: 1, finish: 39 });
    seedResult(p.db, { raceId: 200, driverId: 2, finish: 1 });
    const { run } = svc.generatePredictions(p, { raceId: 200, stage: "thursday", write: false });
    // Prediction still follows PRIOR form, not the target race's outcome.
    expect(run.predictions[0]!.driverId).toBe(1);
  });

  test("a race with no completed predecessors refuses loudly", () => {
    const db = testDb();
    seedDriver(db, 1, "A");
    seedRace(db, { raceId: 300, season: 2026, raceDateUtc: "2026-02-01T18:00:00" });
    expect(() => svc.generatePredictions({ db }, { raceId: 300, stage: "thursday" })).toThrow(/No completed races/);
    expect(() => svc.generatePredictions({ db }, { raceId: 999, stage: "thursday" })).toThrow(/not found/);
  });
});

import { describe, expect, test } from "bun:test";
import {
  bucketOf,
  passEfficiency,
  isDnf,
  buildLeagueExpectations,
  computeSeasonStats,
  computeTrackTypeStats,
  computeForm,
  qualifiedRegulars,
  rankByMetric,
} from "../src/domains/analytics/service.ts";
import type {
  PointsResultRow,
  PointsLoopRow,
  SeasonStanding,
} from "../src/domains/analytics/types.ts";

function standing(
  over: Partial<SeasonStanding> & { driverId: number; loopRaces: number },
): SeasonStanding {
  return {
    seriesId: 1,
    season: 2024,
    fullName: `Driver ${over.driverId}`,
    races: over.loopRaces,
    wins: 0,
    top5s: 0,
    top10s: 0,
    dnfs: 0,
    avgStart: null,
    avgFinish: null,
    lapsLed: 0,
    points: 0,
    playoffPoints: 0,
    avgRating: null,
    top15LapPct: null,
    fastLapPct: null,
    passEfficiency: null,
    adjPassEfficiency: null,
    avgClosingGain: null,
    closerScore: null,
    ...over,
  };
}

function result(over: Partial<PointsResultRow> & { raceId: number; driverId: number; finish: number }): PointsResultRow {
  return {
    seriesId: 1,
    season: 2024,
    trackType: "intermediate",
    raceDateUtc: `2024-06-${String(over.raceId % 28 + 1).padStart(2, "0")}T18:00:00`,
    start: over.finish,
    status: "Running",
    lapsLed: 0,
    points: 0,
    playoffPoints: 0,
    ...over,
  };
}

function loop(over: Partial<PointsLoopRow> & { raceId: number; driverId: number; avgPs: number }): PointsLoopRow {
  return {
    seriesId: 1,
    season: 2024,
    trackType: "intermediate",
    closingPs: Math.round(over.avgPs),
    closingLapsDiff: 0,
    passesGf: 0,
    passedGf: 0,
    fastLaps: 0,
    top15Laps: 0,
    laps: 100,
    rating: 80,
    ...over,
  };
}

describe("bucketOf", () => {
  test("bucket 0 is P1–P5, bucket 1 is P6–P10", () => {
    expect(bucketOf(1)).toBe(0);
    expect(bucketOf(5)).toBe(0);
    expect(bucketOf(6)).toBe(1);
    expect(bucketOf(10)).toBe(1);
    expect(bucketOf(11)).toBe(2);
  });
  test("handles fractional avg_ps and clamps below P1", () => {
    expect(bucketOf(12.3)).toBe(2);
    expect(bucketOf(0.5)).toBe(0);
  });
});

describe("passEfficiency", () => {
  test("share of encounters won", () => {
    expect(passEfficiency(10, 5)).toBeCloseTo(10 / 15);
  });
  test("null when no green-flag encounters", () => {
    expect(passEfficiency(0, 0)).toBeNull();
  });
});

describe("isDnf", () => {
  test("Running and unknown-ish statuses are not DNFs", () => {
    expect(isDnf("Running")).toBe(false);
    expect(isDnf(null)).toBe(false);
    expect(isDnf("")).toBe(false);
    expect(isDnf("   ")).toBe(false);
    expect(isDnf("Stage 1 Winner")).toBe(false);
  });
  test("failure reasons are DNFs", () => {
    expect(isDnf("Accident")).toBe(true);
    expect(isDnf("Engine")).toBe(true);
    expect(isDnf("DVP")).toBe(true);
  });
});

describe("buildLeagueExpectations", () => {
  test("means per position bucket", () => {
    const loops = [
      loop({ raceId: 1, driverId: 1, avgPs: 3, passesGf: 8, passedGf: 2, closingPs: 3, closingLapsDiff: 2 }),
      loop({ raceId: 1, driverId: 2, avgPs: 4, passesGf: 2, passedGf: 8, closingPs: 4, closingLapsDiff: -2 }),
      loop({ raceId: 1, driverId: 3, avgPs: 8, passesGf: 5, passedGf: 5, closingPs: 8, closingLapsDiff: 4 }),
    ];
    const exp = buildLeagueExpectations(loops);
    // bucket 0: mean(0.8, 0.2) = 0.5; bucket 1: 0.5
    expect(exp.passEfficiencyByAvgPs.get(0)).toBeCloseTo(0.5);
    expect(exp.passEfficiencyByAvgPs.get(1)).toBeCloseTo(0.5);
    expect(exp.closingGainByClosingPs.get(0)).toBeCloseTo(0);
    expect(exp.closingGainByClosingPs.get(1)).toBeCloseTo(4);
  });
  test("drivers with zero encounters do not pollute the pass baseline", () => {
    const loops = [
      loop({ raceId: 1, driverId: 1, avgPs: 2, passesGf: 6, passedGf: 2 }),
      loop({ raceId: 1, driverId: 2, avgPs: 2, passesGf: 0, passedGf: 0 }),
    ];
    const exp = buildLeagueExpectations(loops);
    expect(exp.passEfficiencyByAvgPs.get(0)).toBeCloseTo(0.75);
  });
});

describe("computeSeasonStats", () => {
  test("aggregates results and residual-based proprietary metrics", () => {
    const results = [
      result({ raceId: 1, driverId: 1, finish: 1, start: 2, lapsLed: 50, points: 50 }),
      result({ raceId: 2, driverId: 1, finish: 4, start: 5, points: 40 }),
      result({ raceId: 3, driverId: 1, finish: 12, start: 20, status: "Accident", points: 10 }),
      result({ raceId: 1, driverId: 2, finish: 6, start: 1 }),
    ];
    const loops = [
      loop({ raceId: 1, driverId: 1, avgPs: 3, passesGf: 8, passedGf: 2, closingPs: 3, closingLapsDiff: 2, rating: 120, top15Laps: 100, fastLaps: 20 }),
      loop({ raceId: 1, driverId: 2, avgPs: 4, passesGf: 2, passedGf: 8, closingPs: 4, closingLapsDiff: -2, rating: 90, top15Laps: 50 }),
    ];
    const stats = computeSeasonStats(results, loops, buildLeagueExpectations(loops));

    const d1 = stats.find((s) => s.driverId === 1)!;
    expect(d1.races).toBe(3);
    expect(d1.wins).toBe(1);
    expect(d1.top5s).toBe(2);
    expect(d1.top10s).toBe(2);
    expect(d1.dnfs).toBe(1);
    expect(d1.avgFinish).toBeCloseTo((1 + 4 + 12) / 3);
    expect(d1.avgStart).toBeCloseTo((2 + 5 + 20) / 3);
    expect(d1.lapsLed).toBe(50);
    expect(d1.points).toBe(100);
    expect(d1.loopRaces).toBe(1);
    expect(d1.avgRating).toBeCloseTo(120);
    expect(d1.top15LapPct).toBeCloseTo(1);
    expect(d1.fastLapPct).toBeCloseTo(0.2);
    // League bucket-0 expectation = mean(0.8, 0.2) = 0.5; d1 raced at 0.8.
    expect(d1.adjPassEfficiency).toBeCloseTo(30);
    // Closing bucket-0 expectation = mean(2, -2) = 0; d1 gained 2.
    expect(d1.closerScore).toBeCloseTo(2);
    expect(d1.avgClosingGain).toBeCloseTo(2);

    const d2 = stats.find((s) => s.driverId === 2)!;
    expect(d2.adjPassEfficiency).toBeCloseTo(-30);
    expect(d2.closerScore).toBeCloseTo(-2);
  });

  test("loop-only participation still yields a row (races 0)", () => {
    const loops = [loop({ raceId: 9, driverId: 7, avgPs: 10, rating: 95 })];
    const stats = computeSeasonStats([], loops, buildLeagueExpectations(loops));
    expect(stats).toHaveLength(1);
    expect(stats[0]!.races).toBe(0);
    expect(stats[0]!.avgFinish).toBeNull();
    expect(stats[0]!.loopRaces).toBe(1);
    expect(stats[0]!.avgRating).toBeCloseTo(95);
  });
});

describe("computeTrackTypeStats", () => {
  test("groups by track type", () => {
    const results = [
      result({ raceId: 1, driverId: 1, finish: 1 }),
      result({ raceId: 2, driverId: 1, finish: 3 }),
      result({ raceId: 3, driverId: 1, finish: 2, trackType: "road" }),
    ];
    const stats = computeTrackTypeStats(results, [], buildLeagueExpectations([]));
    const inter = stats.find((s) => s.trackType === "intermediate")!;
    const road = stats.find((s) => s.trackType === "road")!;
    expect(inter.races).toBe(2);
    expect(inter.avgFinish).toBeCloseTo(2);
    expect(road.races).toBe(1);
    expect(road.wins).toBe(0);
  });
});

describe("qualifiedRegulars", () => {
  test("keeps drivers at or above the loop-share threshold of the season max", () => {
    const rows = [
      standing({ driverId: 1, loopRaces: 20 }), // max
      standing({ driverId: 2, loopRaces: 10 }), // exactly 50%
      standing({ driverId: 3, loopRaces: 9 }), // below 50%
    ];
    const kept = qualifiedRegulars(rows, 0.5).map((r) => r.driverId).sort();
    expect(kept).toEqual([1, 2]);
  });
  test("empty when no driver has loop data", () => {
    expect(qualifiedRegulars([standing({ driverId: 1, loopRaces: 0 })], 0.5)).toEqual([]);
  });
});

describe("rankByMetric", () => {
  test("ranks best (highest) first with rank, field, and percentile", () => {
    const rows = [
      standing({ driverId: 1, loopRaces: 10, adjPassEfficiency: 1 }),
      standing({ driverId: 2, loopRaces: 10, adjPassEfficiency: 5 }),
      standing({ driverId: 3, loopRaces: 10, adjPassEfficiency: 3 }),
    ];
    const ranked = rankByMetric(rows, "adjPassEfficiency");
    expect(ranked.map((r) => r.driverId)).toEqual([2, 3, 1]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.every((r) => r.field === 3)).toBe(true);
    // rank 1 → 100th pctl, last → 0.
    expect(ranked[0]!.percentile).toBe(100);
    expect(ranked[1]!.percentile).toBe(50);
    expect(ranked[2]!.percentile).toBe(0);
  });
  test("drops drivers with a null value for the metric", () => {
    const rows = [
      standing({ driverId: 1, loopRaces: 10, closerScore: 0.2 }),
      standing({ driverId: 2, loopRaces: 10, closerScore: null }),
    ];
    const ranked = rankByMetric(rows, "closerScore");
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.driverId).toBe(1);
    expect(ranked[0]!.percentile).toBe(100); // single-driver field
  });
});

describe("computeForm", () => {
  test("trailing window grows to the configured size", () => {
    const results = [
      result({ raceId: 1, driverId: 1, finish: 10, raceDateUtc: "2024-03-01T18:00:00" }),
      result({ raceId: 2, driverId: 1, finish: 20, raceDateUtc: "2024-03-08T18:00:00" }),
      result({ raceId: 3, driverId: 1, finish: 30, raceDateUtc: "2024-03-15T18:00:00" }),
      result({ raceId: 4, driverId: 1, finish: 2, raceDateUtc: "2024-03-22T18:00:00" }),
    ];
    const form = computeForm(results, [], 3).sort((a, b) => a.raceId - b.raceId);
    expect(form.map((f) => f.windowRaces)).toEqual([1, 2, 3, 3]);
    expect(form[0]!.avgFinish).toBeCloseTo(10);
    expect(form[2]!.avgFinish).toBeCloseTo(20);
    expect(form[3]!.avgFinish).toBeCloseTo((20 + 30 + 2) / 3);
  });

  test("loop-derived form fields use only the races that have loop rows", () => {
    const results = [
      result({ raceId: 1, driverId: 1, finish: 5, raceDateUtc: "2024-03-01T18:00:00" }),
      result({ raceId: 2, driverId: 1, finish: 5, raceDateUtc: "2024-03-08T18:00:00" }),
    ];
    const loops = [loop({ raceId: 2, driverId: 1, avgPs: 5, rating: 100, closingLapsDiff: 3 })];
    const form = computeForm(results, loops, 6).sort((a, b) => a.raceId - b.raceId);
    expect(form[0]!.avgRating).toBeNull();
    expect(form[1]!.avgRating).toBeCloseTo(100);
    expect(form[1]!.avgClosingGain).toBeCloseTo(3);
  });
});

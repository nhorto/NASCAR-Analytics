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
  computeRaceStandouts,
  computeStandingsMovement,
  pickFormCallouts,
  regularSeasonField,
  playoffPicture,
} from "../src/domains/analytics/service.ts";
import type { DriverSeasonAgg } from "../src/domains/analytics/service.ts";
import type {
  PointsResultRow,
  PointsLoopRow,
  SeasonStanding,
  SeasonPointsResultRow,
  RaceSlot,
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

describe("computeRaceStandouts", () => {
  test("applies the season residual math to a single race", () => {
    const loops = [
      loop({ raceId: 1, driverId: 1, avgPs: 3, passesGf: 8, passedGf: 2, closingPs: 3, closingLapsDiff: 2, rating: 120 }),
      loop({ raceId: 1, driverId: 2, avgPs: 4, passesGf: 2, passedGf: 8, closingPs: 4, closingLapsDiff: -2, rating: 90 }),
    ];
    const out = computeRaceStandouts(loops, buildLeagueExpectations(loops));
    const d1 = out.find((s) => s.driverId === 1)!;
    const d2 = out.find((s) => s.driverId === 2)!;
    // bucket-0 pass baseline = mean(0.8, 0.2) = 0.5 → ±30; closing baseline = 0 → ±2.
    expect(d1.adjPassEfficiency).toBeCloseTo(30);
    expect(d1.closerScore).toBeCloseTo(2);
    expect(d1.rating).toBeCloseTo(120);
    expect(d2.adjPassEfficiency).toBeCloseTo(-30);
    expect(d2.closerScore).toBeCloseTo(-2);
  });

  test("adjPE is null when a driver had no green-flag encounters", () => {
    const loops = [loop({ raceId: 1, driverId: 1, avgPs: 5, passesGf: 0, passedGf: 0 })];
    const out = computeRaceStandouts(loops, buildLeagueExpectations(loops));
    expect(out[0]!.adjPassEfficiency).toBeNull();
  });
});

describe("computeStandingsMovement", () => {
  function row(o: Partial<SeasonPointsResultRow> & { raceId: number; driverId: number; finish: number; points: number }): SeasonPointsResultRow {
    return {
      fullName: `Driver ${o.driverId}`,
      playoffPoints: 0,
      raceDateUtc: o.raceId === 1 ? "2024-03-01T18:00:00" : "2024-03-08T18:00:00",
      ...o,
    };
  }

  test("ranks after the race with movement vs. the prior race", () => {
    const rows = [
      row({ raceId: 1, driverId: 1, finish: 1, points: 40 }),
      row({ raceId: 1, driverId: 2, finish: 2, points: 35 }),
      row({ raceId: 1, driverId: 3, finish: 3, points: 34 }),
      row({ raceId: 2, driverId: 1, finish: 3, points: 34 }),
      row({ raceId: 2, driverId: 2, finish: 1, points: 45 }),
      row({ raceId: 2, driverId: 3, finish: 2, points: 40 }),
    ];
    const mv = computeStandingsMovement(rows, 2, 2);
    // After R2: d2=80(1), d1=74(2, win tie-break over d3), d3=74(3).
    expect(mv.map((m) => m.driverId)).toEqual([2, 1, 3]);
    expect(mv[0]!).toMatchObject({ driverId: 2, rank: 1, prevRank: 2, rankDelta: 1, pointsThisRace: 45, inPlayoff: true });
    expect(mv[1]!).toMatchObject({ driverId: 1, rank: 2, prevRank: 1, rankDelta: -1, inPlayoff: true });
    expect(mv[2]!).toMatchObject({ driverId: 3, rank: 3, prevRank: 3, rankDelta: 0, inPlayoff: false });
  });

  test("first race of the season has null movement", () => {
    const rows = [
      row({ raceId: 1, driverId: 1, finish: 1, points: 40 }),
      row({ raceId: 1, driverId: 2, finish: 2, points: 35 }),
    ];
    const mv = computeStandingsMovement(rows, 1, 16);
    expect(mv.every((m) => m.prevRank === null && m.rankDelta === null)).toBe(true);
  });

  test("returns empty for a race not in the set", () => {
    expect(computeStandingsMovement([], 99, 16)).toEqual([]);
  });
});

describe("pickFormCallouts", () => {
  const results = [
    { driverId: 1, fullName: "D1", finish: 2 },
    { driverId: 2, fullName: "D2", finish: 20 },
    { driverId: 3, fullName: "D3", finish: 5 },
  ];

  test("splits over/under vs. prior form and ignores drivers with no baseline", () => {
    const prior = new Map([
      [1, 10], // finished P2 vs 10 form → +8 over
      [2, 8], //  finished P20 vs 8 form → −12 under
      // d3 has no prior form → excluded
    ]);
    const { over, under } = pickFormCallouts(results, prior, 3);
    expect(over.map((c) => c.driverId)).toEqual([1]);
    expect(over[0]!.delta).toBeCloseTo(8);
    expect(under.map((c) => c.driverId)).toEqual([2]);
  });

  test("caps each side at count, strongest first", () => {
    const prior = new Map([
      [1, 10], // +8
      [3, 25], // +20
    ]);
    const { over } = pickFormCallouts(results, prior, 1);
    expect(over.map((c) => c.driverId)).toEqual([3]); // biggest overachievement only
  });
});

// A tiny format for playoff tests: 4 in, cut to 2 after a 2-race round, then a
// 1-race championship. Playoff-race count = 3 (the last 3 of the season).
const FMT = { fieldSize: 4, roundCuts: [2], roundRaces: [2, 1] };

function agg(o: Partial<DriverSeasonAgg> & { driverId: number }): DriverSeasonAgg {
  return { fullName: `D${o.driverId}`, points: 0, wins: 0, playoffPoints: 0, ...o };
}

describe("regularSeasonField", () => {
  test("win-and-in: winners locked, remaining spots by points, cut + bubble", () => {
    const aggs = [
      agg({ driverId: 1, points: 100, wins: 1, playoffPoints: 5 }), // winner
      agg({ driverId: 2, points: 90, wins: 0, playoffPoints: 1 }), //  winless, top points
      agg({ driverId: 3, points: 80, wins: 1, playoffPoints: 3 }), // winner
      agg({ driverId: 4, points: 70, wins: 0 }), //                   winless (in on points)
      agg({ driverId: 5, points: 60, wins: 0 }), //                   bubble
      agg({ driverId: 6, points: 50, wins: 0 }), //                   out
    ];
    const rows = regularSeasonField(aggs, FMT);
    const status = new Map(rows.map((r) => [r.driverId, r.status]));
    expect(status.get(1)).toBe("in-win");
    expect(status.get(3)).toBe("in-win");
    expect(status.get(2)).toBe("in-points");
    expect(status.get(4)).toBe("in-points");
    expect(status.get(5)).toBe("bubble");
    expect(status.get(6)).toBe("out");
    // in-field is exactly the field size
    expect(rows.filter((r) => r.status === "in-win" || r.status === "in-points")).toHaveLength(4);
    // points behind the cut (last in-points = D4 @ 70)
    expect(rows.find((r) => r.driverId === 5)!.pointsToCut).toBe(10);
    expect(rows.find((r) => r.driverId === 6)!.pointsToCut).toBe(20);
  });

  test("more winners than spots: top field by playoff points, rest out", () => {
    const aggs = [
      agg({ driverId: 1, points: 100, wins: 1, playoffPoints: 10 }),
      agg({ driverId: 2, points: 95, wins: 1, playoffPoints: 8 }),
      agg({ driverId: 3, points: 90, wins: 1, playoffPoints: 6 }),
      agg({ driverId: 4, points: 85, wins: 1, playoffPoints: 4 }),
      agg({ driverId: 5, points: 80, wins: 1, playoffPoints: 2 }), // 5th winner → bubble
      agg({ driverId: 6, points: 70, wins: 0 }), //                   winless → out
    ];
    const rows = regularSeasonField(aggs, FMT);
    const status = new Map(rows.map((r) => [r.driverId, r.status]));
    expect([1, 2, 3, 4].map((d) => status.get(d))).toEqual(["in-win", "in-win", "in-win", "in-win"]);
    expect(status.get(5)).toBe("bubble");
    expect(status.get(6)).toBe("out");
  });
});

describe("playoffPicture (phase-aware)", () => {
  function pr(raceId: number, driverId: number, finish: number, points: number, pp = 0): SeasonPointsResultRow {
    return { raceId, driverId, fullName: `D${driverId}`, finish, points, playoffPoints: pp, raceDateUtc: `2024-0${raceId}-01T18:00:00` };
  }
  const seq: RaceSlot[] = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ raceId: id, raceDateUtc: `2024-0${id}-01T18:00:00` }));
  // Regular season decided in race 1 (no winners → field is top-4 by points).
  const regular = [
    pr(1, 1, 2, 100), pr(1, 2, 3, 90), pr(1, 3, 4, 80),
    pr(1, 4, 5, 70), pr(1, 5, 6, 60), pr(1, 6, 7, 50),
  ];
  // Round of 4 (races 5, 6): D4 wins race 5 (auto-advance) despite low points.
  const playoff = [
    pr(5, 1, 2, 40), pr(5, 2, 3, 38), pr(5, 3, 20, 5), pr(5, 4, 1, 3),
    pr(6, 1, 2, 30), pr(6, 2, 3, 28), pr(6, 3, 20, 5), pr(6, 4, 4, 3),
    pr(7, 1, 1, 40), pr(7, 4, 2, 35), // championship
  ];
  const rows = [...regular, ...playoff];

  test("regular-season race → win-and-in field", () => {
    const pic = playoffPicture(rows, seq, FMT, 1);
    expect(pic.phase).toBe("regular");
    expect(pic.roundLabel).toBe("Regular Season");
    const inField = pic.rows.filter((r) => r.status === "in-points" || r.status === "in-win").map((r) => r.driverId).sort();
    expect(inField).toEqual([1, 2, 3, 4]);
    expect(pic.rows.find((r) => r.driverId === 5)!.status).toBe("bubble");
  });

  test("first playoff race → Round of 4", () => {
    const pic = playoffPicture(rows, seq, FMT, 5);
    expect(pic.phase).toBe("playoff");
    expect(pic.roundLabel).toBe("Round of 4");
    expect(pic.cutSize).toBe(2);
  });

  test("championship race → round eliminations + auto-advance resolved", () => {
    const pic = playoffPicture(rows, seq, FMT, 7);
    expect(pic.phase).toBe("playoff");
    expect(pic.roundLabel).toBe("Championship 2");
    const survivors = pic.rows.filter((r) => r.status !== "eliminated").map((r) => r.driverId).sort();
    const eliminated = pic.rows.filter((r) => r.status === "eliminated").map((r) => r.driverId).sort();
    // D4 auto-advanced on its race-5 win; D1 advanced on points; D2/D3 eliminated.
    expect(survivors).toEqual([1, 4]);
    expect(eliminated).toEqual([2, 3]);
  });
});

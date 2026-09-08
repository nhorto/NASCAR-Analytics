// Deep-tools view-models: the season-range aggregation (whose weighting rule
// is the whole reason `loopRaces` exists in the payload), the compare table,
// and the track-type board.
import { describe, expect, test } from "bun:test";
import { parseSeasons, type SeasonStatsRow } from "../../drivers/api.ts";
import { parseTrackBoard } from "../api.ts";
import {
  aggregateSeasons,
  coerceRange,
  compareTable,
  sortTrackLeaders,
  trackMetricText,
  type ComparePick,
} from "../model.ts";

const SEASONS = parseSeasons({
  seasons: [
    // A pre-loop-data season: real races, no rating/adjPE/closer at all.
    {
      season: 2016, races: 36, wins: 1, top5s: 8, top10s: 15, avgStart: 14, avgFinish: 16,
      lapsLed: 200, points: 900, avgRating: null, adjPassEfficiency: null, closerScore: null,
      loopRaces: 0, top15LapPct: null,
    },
    {
      season: 2025, races: 30, wins: 3, top5s: 12, top10s: 20, avgStart: 8, avgFinish: 10,
      lapsLed: 800, points: 1200, avgRating: 100, adjPassEfficiency: 1.0, closerScore: 0.5,
      loopRaces: 30, top15LapPct: 0.6,
    },
    {
      season: 2026, races: 10, wins: 1, top5s: 4, top10s: 7, avgStart: 4, avgFinish: 6,
      lapsLed: 300, points: 500, avgRating: 110, adjPassEfficiency: 2.0, closerScore: 1.5,
      loopRaces: 10, top15LapPct: 0.8,
    },
  ],
});

describe("aggregateSeasons", () => {
  test("counting stats sum across the range", () => {
    const agg = aggregateSeasons(SEASONS, 2025, 2026)!;
    expect(agg.races).toBe(40);
    expect(agg.wins).toBe(4);
    expect(agg.lapsLed).toBe(1100);
    expect(agg.points).toBe(1700);
  });

  test("average finish and start weight by races, not by season count", () => {
    const agg = aggregateSeasons(SEASONS, 2025, 2026)!;
    // (10*30 + 6*10) / 40 = 9, not the naive (10 + 6) / 2 = 8.
    expect(agg.avgFinish).toBeCloseTo(9, 10);
    expect(agg.avgStart).toBeCloseTo(7, 10);
  });

  test("loop metrics weight by loopRaces so a pre-loop season cannot dilute them", () => {
    // 2016 has 36 races and zero loop races. Weighting by `races` would pull
    // the rating toward zero; weighting by `loopRaces` leaves it untouched.
    const withDeadSeason = aggregateSeasons(SEASONS, 2016, 2026)!;
    const withoutIt = aggregateSeasons(SEASONS, 2025, 2026)!;
    expect(withDeadSeason.avgRating).toBeCloseTo(withoutIt.avgRating!, 10);
    expect(withDeadSeason.avgRating).toBeCloseTo(102.5, 10);
    expect(withDeadSeason.adjPE).toBeCloseTo(1.25, 10);
    expect(withDeadSeason.top15).toBeCloseTo(0.65, 10);
    // …but the counting stats do pick the old season up.
    expect(withDeadSeason.races).toBe(76);
  });

  test("a range with no seasons in it is null, not a row of zeroes", () => {
    expect(aggregateSeasons(SEASONS, 1999, 2000)).toBeNull();
    expect(aggregateSeasons([], 2026, 2026)).toBeNull();
  });

  test("a driver with only pre-loop seasons has null loop metrics, not zero", () => {
    const agg = aggregateSeasons(SEASONS, 2016, 2016)!;
    expect(agg.avgRating).toBeNull();
    expect(agg.adjPE).toBeNull();
    expect(agg.avgFinish).toBe(16);
  });
});

describe("compareTable", () => {
  function pick(key: string, over: Partial<SeasonStatsRow> = {}): ComparePick {
    const stats = aggregateSeasons(
      parseSeasons({ seasons: [{ ...(SEASONS[1] as SeasonStatsRow), ...over }] }),
      2000,
      2100,
    )!;
    return { key, name: key, stats };
  }

  test("lower is better for finishing and starting positions", () => {
    const table = compareTable([pick("A", { avgFinish: 8 }), pick("B", { avgFinish: 12 })]);
    const finish = table.find((row) => row.label === "Avg Finish")!;
    expect(finish.cells.map((c) => c.best)).toEqual([true, false]);
  });

  test("higher is better everywhere else", () => {
    const table = compareTable([pick("A", { wins: 1 }), pick("B", { wins: 5 })]);
    expect(table.find((row) => row.label === "Wins")!.cells.map((c) => c.best)).toEqual([
      false,
      true,
    ]);
  });

  test("four drivers use the same layout and still mark one winner per metric", () => {
    const table = compareTable([
      pick("A", { avgFinish: 12 }),
      pick("B", { avgFinish: 9 }),
      pick("C", { avgFinish: 15 }),
      pick("D", { avgFinish: 9 }),
    ]);
    const finish = table.find((row) => row.label === "Avg Finish")!;
    expect(finish.cells.length).toBe(4);
    // A tie marks both, which is honest — there is no tiebreak to invent.
    expect(finish.cells.map((c) => c.best)).toEqual([false, true, false, true]);
  });

  test("a driver with no loop data does not win the loop metrics by default", () => {
    const table = compareTable([
      pick("A", { avgRating: null, loopRaces: 0 }),
      pick("B", { avgRating: 95 }),
    ]);
    const rating = table.find((row) => row.label === "Rating")!;
    expect(rating.cells[0]).toEqual({ text: "—", best: false });
    expect(rating.cells[1]!.best).toBe(true);
  });

  test("a single driver has nothing to win against", () => {
    const table = compareTable([pick("A")]);
    expect(table.every((row) => row.cells.every((cell) => !cell.best))).toBe(true);
  });

  test("residual metrics render signed, the way the web does", () => {
    const table = compareTable([pick("A", { closerScore: -0.4, adjPassEfficiency: 1.2 })]);
    expect(table.find((r) => r.label === "Closer")!.cells[0]!.text).toBe("−0.40");
    expect(table.find((r) => r.label === "Adj Pass Eff")!.cells[0]!.text).toBe("+1.2");
  });
});

describe("the track-type board", () => {
  const BOARD = parseTrackBoard({
    seriesId: 1,
    trackType: "road",
    fromSeason: 2019,
    toSeason: 2026,
    minStarts: 5,
    leaders: [
      { driverId: 1, fullName: "Road Ace", starts: 20, wins: 5, top5s: 12, avgFinish: 7.1, avgRating: 105, adjPassEfficiency: 1.8, closerScore: 0.9 },
      { driverId: 2, fullName: "Steady Sam", starts: 18, wins: 0, top5s: 4, avgFinish: 12.4, avgRating: 92, adjPassEfficiency: 2.4, closerScore: -0.2 },
      { driverId: 3, fullName: "No Loop", starts: 6, wins: 0, top5s: 0, avgFinish: 22.5, avgRating: null, adjPassEfficiency: null, closerScore: null },
    ],
  })!;

  test("parses the envelope and its filters", () => {
    expect(BOARD.leaders.length).toBe(3);
    expect(BOARD.fromSeason).toBe(2019);
    expect(BOARD.minStarts).toBe(5);
  });

  test("the Pro-gate body is not a board", () => {
    expect(parseTrackBoard({ error: "pro_required", upgrade: "/pricing" })).toBeNull();
  });

  test("average finish sorts ascending; every other metric descending", () => {
    expect(sortTrackLeaders(BOARD.leaders, "avgFinish").map((r) => r.driverId)).toEqual([1, 2, 3]);
    expect(sortTrackLeaders(BOARD.leaders, "adjPassEfficiency").map((r) => r.driverId)).toEqual([
      2, 1, 3,
    ]);
  });

  test("drivers with no loop data sort last rather than first", () => {
    // "No loop data" is an absence, not a score of zero.
    expect(sortTrackLeaders(BOARD.leaders, "closerScore").at(-1)!.driverId).toBe(3);
    expect(sortTrackLeaders(BOARD.leaders, "avgRating").at(-1)!.driverId).toBe(3);
  });

  test("sorting does not mutate the board", () => {
    const before = BOARD.leaders.map((r) => r.driverId);
    sortTrackLeaders(BOARD.leaders, "closerScore");
    expect(BOARD.leaders.map((r) => r.driverId)).toEqual(before);
  });

  test("the metric column formats per key", () => {
    const ace = BOARD.leaders[0]!;
    expect(trackMetricText(ace, "avgFinish")).toBe("7.1");
    expect(trackMetricText(ace, "avgRating")).toBe("105.0");
    expect(trackMetricText(ace, "adjPassEfficiency")).toBe("+1.8");
    expect(trackMetricText(ace, "closerScore")).toBe("+0.90");
    expect(trackMetricText(BOARD.leaders[2]!, "closerScore")).toBe("—");
  });
});

describe("coerceRange", () => {
  test("a coherent range is left alone", () => {
    expect(coerceRange({ from: 2019, to: 2026 }, "from")).toEqual({ from: 2019, to: 2026 });
  });

  test("dragging one end past the other moves both, never inverts", () => {
    expect(coerceRange({ from: 2026, to: 2019 }, "from")).toEqual({ from: 2026, to: 2026 });
    expect(coerceRange({ from: 2026, to: 2019 }, "to")).toEqual({ from: 2019, to: 2019 });
  });
});

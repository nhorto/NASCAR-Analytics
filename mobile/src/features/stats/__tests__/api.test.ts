// Standings + metric-board parsing over server-shaped fixtures.
import { describe, expect, test } from "bun:test";
import { parseMetricBoard, parseStandings } from "../api.ts";

describe("parseStandings", () => {
  test("parses SeasonStanding rows and tolerates junk", () => {
    const parsed = parseStandings({
      seriesId: 1,
      season: 2026,
      standings: [
        { driverId: 4025, fullName: "Kyle Larson", points: 1800, wins: 4, top5s: 13, avgFinish: 10.1 },
        { driverId: 4030, fullName: "Denny Hamlin", points: 1720, wins: 3, top5s: 11, avgFinish: null },
        { fullName: "No Id" },
      ],
    });
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toEqual({
      driverId: 4025,
      fullName: "Kyle Larson",
      points: 1800,
      wins: 4,
      top5s: 13,
      avgFinish: 10.1,
    });
    expect(parsed[1]!.avgFinish).toBeNull();
  });

  test("the Pro-gate 403 body parses to empty rather than throwing", () => {
    expect(parseStandings({ error: "pro_required", upgrade: "/pricing" })).toEqual([]);
  });
});

describe("parseMetricBoard", () => {
  const board = {
    seriesId: 1,
    season: 2026,
    qualified: 34,
    adjPass: [{ driverId: 4025, fullName: "Kyle Larson", loopRaces: 27, value: 1.61, rank: 1, field: 34, percentile: 100 }],
    closer: [{ driverId: 4030, fullName: "Denny Hamlin", loopRaces: 27, value: 1.1, rank: 1, field: 34, percentile: 100 }],
  };

  test("reads each board by key", () => {
    expect(parseMetricBoard(board, "adjPass")).toEqual([
      { driverId: 4025, fullName: "Kyle Larson", value: 1.61, rank: 1 },
    ]);
    expect(parseMetricBoard(board, "closer")[0]!.fullName).toBe("Denny Hamlin");
  });

  test("missing boards parse to empty", () => {
    expect(parseMetricBoard(null, "adjPass")).toEqual([]);
    expect(parseMetricBoard({ adjPass: "nope" }, "adjPass")).toEqual([]);
  });
});

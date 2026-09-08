// Driver list/profile parsing + view-models over server-shaped fixtures.
import { describe, expect, test } from "bun:test";
import { parseDrivers, parseSeasons, type DriverProfile } from "../api.ts";
import { driverListRows, fmt, profileModel, seasonStatLines } from "../model.ts";

const SUMMARY = {
  driverId: 4025,
  fullName: "Kyle Larson",
  firstSeason: 2014,
  lastSeason: 2026,
  races: 420,
  wins: 31,
  latestTeam: "Hendrick Motorsports",
  latestCarNumber: "5",
  latestCarMake: "Chevrolet",
};

describe("parseDrivers", () => {
  test("parses the /api/drivers envelope and drops junk entries", () => {
    const parsed = parseDrivers({ seriesId: 1, drivers: [SUMMARY, { fullName: 42 }, null] });
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.fullName).toBe("Kyle Larson");
  });

  test("non-envelope shapes parse to empty, not throw", () => {
    expect(parseDrivers({ error: "pro_required" })).toEqual([]);
    expect(parseDrivers(null)).toEqual([]);
  });
});

describe("driverListRows", () => {
  test("builds the subtitle line and filters case-insensitively", () => {
    const rows = driverListRows([SUMMARY], "");
    expect(rows[0]!.line).toBe("#5 · Hendrick Motorsports · 420 races · 31 wins");
    expect(driverListRows([SUMMARY], "LARS").length).toBe(1);
    expect(driverListRows([SUMMARY], "hamlin").length).toBe(0);
  });

  test("zero-value fields stay out of the line", () => {
    const rows = driverListRows(
      [{ ...SUMMARY, wins: 0, latestTeam: null, latestCarNumber: null }],
      "",
    );
    expect(rows[0]!.line).toBe("420 races");
  });
});

describe("profileModel", () => {
  const seasons = parseSeasons({
    seasons: [
      { season: 2025, races: 36, wins: 3, top5s: 15, top10s: 22, avgStart: 8.2, avgFinish: 11.4, lapsLed: 1200, points: 2280, avgRating: 98.7, adjPassEfficiency: 1.42, closerScore: 0.8 },
      { season: 2026, races: 27, wins: 4, top5s: 13, top10s: 19, avgStart: 7.9, avgFinish: 10.1, lapsLed: 900, points: 1800, avgRating: 101.2, adjPassEfficiency: 1.61, closerScore: 1.1 },
    ],
  });

  const profile: DriverProfile = {
    driver: SUMMARY,
    seasons,
    raceLog: [
      { raceId: 9001, season: 2026, raceName: "Southern 500", start: 3, finish: 2, lapsLed: 88, rating: 118.2 },
      { raceId: 9000, season: 2026, raceName: "Coke 600", start: null, finish: 14, lapsLed: 0, rating: null },
    ],
  };

  test("picks the latest season and formats identity + races", () => {
    const model = profileModel(profile);
    expect(model.subtitle).toBe("#5 · Hendrick Motorsports · Chevrolet · 2014–2026");
    expect(model.latestSeason!.season).toBe(2026);
    expect(model.recentRaces[0]).toEqual({
      key: "9001",
      line: "2026 · Southern 500 · started 3",
      finish: "P2",
    });
    // A null start must not render "started null".
    expect(model.recentRaces[1]!.line).toBe("2026 · Coke 600");
  });

  test("stat lines format nulls as em dashes", () => {
    const lines = seasonStatLines({ ...seasons[0]!, avgRating: null, adjPassEfficiency: null });
    expect(lines.find((l) => l.label === "Rating")!.value).toBe("—");
    expect(lines.find((l) => l.label === "adjPE")!.value).toBe("—");
    expect(lines.find((l) => l.label === "Avg finish")!.value).toBe("11.4");
  });

  test("fmt rounds and dashes", () => {
    expect(fmt(11.44)).toBe("11.4");
    expect(fmt(null)).toBe("—");
    expect(fmt(1.234, 2)).toBe("1.23");
  });
});

// The nascaR.data fallback mapping (pure): name canonicalization, the ordinal
// join with its track-name guard, and the SportsDataIO stub's normalizer.
import { describe, expect, test } from "bun:test";
import { dataHealthService } from "../src/domains/data-health/index.ts";
import type { FallbackDriverRef, FallbackRaceRef, NascarDataRow } from "../src/domains/data-health/index.ts";
import { normalizeSdioResults, assertUsable, racesUrl } from "../src/providers/sportsdataio.ts";
import { nascarDataUrl } from "../src/providers/nascar-data.ts";

const { canonicalDriverName, trackNamesMatch, mapFallbackResults } = dataHealthService;

describe("canonicalDriverName", () => {
  test("periods, case, spacing, and diacritics are insignificant", () => {
    expect(canonicalDriverName("A.J. Allmendinger")).toBe(canonicalDriverName("AJ Allmendinger"));
    expect(canonicalDriverName("Martin Truex Jr.")).toBe(canonicalDriverName("martin truex jr"));
    expect(canonicalDriverName("  Ross  Chastain ")).toBe("ross chastain");
    expect(canonicalDriverName("Daniel Suárez")).toBe("daniel suarez");
  });
  test("entry markers are stripped", () => {
    expect(canonicalDriverName("Kyle Larson #")).toBe("kyle larson");
    expect(canonicalDriverName("Connor Zilisch (i)")).toBe("connor zilisch");
  });
  test("different drivers stay different", () => {
    expect(canonicalDriverName("Kyle Busch")).not.toBe(canonicalDriverName("Kurt Busch"));
  });
});

describe("trackNamesMatch", () => {
  test("exact and prefix matches pass", () => {
    expect(trackNamesMatch("Darlington Raceway", "Darlington Raceway")).toBe(true);
    expect(trackNamesMatch("Bristol Motor Speedway Dirt", "Bristol Motor Speedway")).toBe(true);
    expect(trackNamesMatch("Charlotte Motor Speedway", "Charlotte Motor Speedway Road Course")).toBe(true);
  });
  test("different venues fail", () => {
    expect(trackNamesMatch("Darlington Raceway", "Daytona International Speedway")).toBe(false);
  });
  test("known renames resolve through the config aliases (verified 2026 release)", () => {
    expect(trackNamesMatch("Atlanta Motor Speedway", "EchoPark Speedway")).toBe(true);
    expect(trackNamesMatch("San Diego Street Course", "Naval Base Coronado")).toBe(true);
  });
});

function releaseRow(over: Partial<NascarDataRow>): NascarDataRow {
  return {
    season: 2026,
    race: 1,
    track: "Daytona International Speedway",
    raceName: "Daytona 500",
    finish: 1,
    start: 5,
    car: "24",
    driver: "William Byron",
    team: "Hendrick Motorsports",
    make: "Chevrolet",
    points: 40,
    laps: 200,
    led: 30,
    status: "running",
    ...over,
  };
}

const RACES: FallbackRaceRef[] = [
  { raceId: 5700, season: 2026, ordinal: 1, trackName: "Daytona International Speedway" },
  { raceId: 5701, season: 2026, ordinal: 2, trackName: "Atlanta Motor Speedway" },
];
const DRIVERS: FallbackDriverRef[] = [
  { driverId: 4001, fullName: "William Byron" },
  { driverId: 4002, fullName: "A.J. Allmendinger" },
];

describe("mapFallbackResults", () => {
  test("joins by ordinal and driver name, carrying exactly the release's fields", () => {
    const mapping = mapFallbackResults(
      [releaseRow({}), releaseRow({ driver: "AJ Allmendinger", finish: 2, start: null, led: 0 })],
      RACES,
      DRIVERS,
    );
    expect(mapping.skippedRaces).toEqual([]);
    expect(mapping.unmatchedDrivers).toEqual([]);
    expect(mapping.races.length).toBe(1);
    const race = mapping.races[0]!;
    expect(race.raceId).toBe(5700);
    expect(race.rows).toEqual([
      {
        raceId: 5700,
        driverId: 4001,
        finishingPosition: 1,
        startingPosition: 5,
        carNumber: "24",
        teamName: "Hendrick Motorsports",
        lapsLed: 30,
        carMake: "Chevrolet",
        pointsEarned: 40,
        lapsCompleted: 200,
        finishingStatus: "running",
      },
      {
        raceId: 5700,
        driverId: 4002,
        finishingPosition: 2,
        startingPosition: null,
        carNumber: "24",
        teamName: "Hendrick Motorsports",
        lapsLed: 0,
        carMake: "Chevrolet",
        pointsEarned: 40,
        lapsCompleted: 200,
        finishingStatus: "running",
      },
    ]);
  });

  test("driver aliases bridge source spellings (John Hunter vs John H. Nemechek)", () => {
    const mapping = mapFallbackResults(
      [releaseRow({ driver: "John Hunter Nemechek" })],
      RACES,
      [{ driverId: 4092, fullName: "John H. Nemechek" }],
    );
    expect(mapping.unmatchedDrivers).toEqual([]);
    expect(mapping.races[0]!.rows[0]!.driverId).toBe(4092);
  });

  test("an unknown driver is reported and dropped, never guessed", () => {
    const mapping = mapFallbackResults([releaseRow({ driver: "Total Stranger" })], RACES, DRIVERS);
    expect(mapping.unmatchedDrivers).toEqual(["Total Stranger"]);
    expect(mapping.races[0]!.rows).toEqual([]);
  });

  test("an ordinal with no points race is skipped with a reason", () => {
    const mapping = mapFallbackResults([releaseRow({ race: 9 })], RACES, DRIVERS);
    expect(mapping.races).toEqual([]);
    expect(mapping.skippedRaces).toEqual([
      { ordinal: 9, reason: "no matching points race in our schedule" },
    ]);
  });

  test("a track mismatch refuses the join (ordinal misalignment guard)", () => {
    // Release says race 2 was at Las Vegas; our ordinal 2 is Atlanta — refuse
    // rather than attach results to the wrong race.
    const mapping = mapFallbackResults(
      [releaseRow({ race: 2, track: "Las Vegas Motor Speedway" })],
      RACES,
      DRIVERS,
    );
    expect(mapping.races).toEqual([]);
    expect(mapping.skippedRaces.length).toBe(1);
    expect(mapping.skippedRaces[0]!.reason).toContain("track mismatch");
  });
});

describe("SportsDataIO stub", () => {
  test("assertUsable refuses unless the stub status is acknowledged", () => {
    expect(() => assertUsable(false)).toThrow(/NOT-FOR-PRODUCTION/);
    expect(() => assertUsable(true)).not.toThrow();
  });

  test("normalizeSdioResults maps their schema onto fallback rows via a name resolver", () => {
    const resolve = (name: string) => (name === "William Byron" ? 4001 : undefined);
    const { rows, unmatchedDrivers } = normalizeSdioResults(
      5700,
      {
        Race: { RaceID: 99, SeasonType: 1, Season: 2026, Name: "Daytona 500", Track: "Daytona", Date: null, DateTime: null },
        DriverRaces: [
          { DriverID: 1, Driver: "William Byron", Manufacturer: "Chevrolet", Number: "24", StartPosition: 5, Position: 1, Laps: 200, LapsLed: 30, Points: 40, Status: "Running" },
          { DriverID: 2, Driver: "Somebody Unknown", Manufacturer: null, Number: null, StartPosition: 2, Position: 2, Laps: 200, LapsLed: 0, Points: 35, Status: "Running" },
          { DriverID: 3, Driver: "William Byron", Manufacturer: null, Number: null, StartPosition: null, Position: null, Laps: null, LapsLed: null, Points: null, Status: null },
        ],
      },
      resolve,
    );
    expect(unmatchedDrivers).toEqual(["Somebody Unknown"]);
    expect(rows).toEqual([
      {
        raceId: 5700,
        driverId: 4001,
        finishingPosition: 1,
        startingPosition: 5,
        carNumber: "24",
        teamName: null,
        lapsLed: 30,
        carMake: "Chevrolet",
        pointsEarned: 40,
        lapsCompleted: 200,
        finishingStatus: "Running",
      },
    ]);
  });

  test("url builders point at the documented hosts and reject unknown series", () => {
    expect(nascarDataUrl(1)).toBe("https://nascar.kylegrealis.com/cup_series.parquet");
    expect(nascarDataUrl(2)).toBe("https://nascar.kylegrealis.com/nxs_series.parquet");
    expect(() => nascarDataUrl(7)).toThrow(/no release for series 7/);
    expect(racesUrl(2026, 1, "KEY")).toBe("https://api.sportsdata.io/v2/nascar/races/sc/2026?key=KEY");
    expect(() => racesUrl(2026, 9, "KEY")).toThrow(/unknown series 9/);
  });
});

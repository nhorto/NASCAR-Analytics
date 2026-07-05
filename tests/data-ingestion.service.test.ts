import { describe, expect, test } from "bun:test";
import {
  normalizeScheduledRaces,
  normalizeRace,
  normalizeDrivers,
  normalizeResults,
  normalizeCautions,
  normalizeRaceLeaders,
  normalizeLoopStats,
  normalizeLapTimes,
  loopStatsExpected,
  lapTimesExpected,
} from "../src/domains/data-ingestion/service.ts";
import { trackTypeFor } from "../src/domains/data-ingestion/config.ts";
import type {
  CdnScheduleEvent,
  CdnWeekendFeed,
  CdnLapTimesFeed,
  CdnLoopStatsRace,
} from "../src/domains/data-ingestion/types.ts";
import scheduleFixture from "./fixtures/schedule-feed.json";
import weekendFixture from "./fixtures/weekend-feed.json";
import lapTimesFixture from "./fixtures/lap-times.json";
import loopStatsFixture from "./fixtures/loopstats.json";

const schedule = scheduleFixture as CdnScheduleEvent[];
const weekend = weekendFixture as CdnWeekendFeed;
const lapTimes = lapTimesFixture as CdnLapTimesFeed;
const loopStats = loopStatsFixture as CdnLoopStatsRace[];

describe("normalizeScheduledRaces", () => {
  test("keeps only race events, deduped by race_id", () => {
    // Fixture: practice + qualifying + race for 5617, plus race 5601.
    const races = normalizeScheduledRaces(schedule, 2026);
    expect(races.map((r) => r.raceId)).toEqual([5617, 5601]);
    expect(races[0]).toEqual({
      raceId: 5617,
      seriesId: 1,
      season: 2026,
      trackId: 99,
      trackName: "Sonoma Raceway",
      raceName: "Toyota / Save Mart 350",
      startTimeUtc: "2026-06-28T19:30:00",
    });
  });

  test("falls back to local start_time when start_time_utc is null (2016-2018 feeds)", () => {
    const event: CdnScheduleEvent = {
      race_id: 4482,
      series_id: 1,
      track_id: 105,
      track_name: "Daytona International Speedway",
      race_name: "Daytona 500",
      event_name: "Race",
      run_type: 3,
      start_time: "2016-02-21T13:30:00",
      start_time_utc: null,
    };
    const races = normalizeScheduledRaces([event], 2016);
    expect(races[0]!.startTimeUtc).toBe("2016-02-21T13:30:00");
  });
});

describe("normalizeRace", () => {
  test("maps weekend_race to a race row with resolved track type", () => {
    const row = normalizeRace(weekend.weekend_race[0]!);
    expect(row.raceId).toBe(5617);
    expect(row.season).toBe(2026);
    expect(row.trackType).toBe("road"); // Sonoma
    expect(row.actualLaps).toBe(110);
    expect(row.stage1Laps).toBe(25);
    expect(row.cautions).toBe(3);
    expect(row.marginOfVictory).toBe(".357");
  });
});

describe("normalizeResults / normalizeDrivers", () => {
  test("one row per result with driver identity", () => {
    const race = weekend.weekend_race[0]!;
    const results = normalizeResults(race);
    const drivers = normalizeDrivers(race);
    expect(results.length).toBe(3);
    expect(drivers.length).toBe(3);
    const winner = results.find((r) => r.finishingPosition === 1)!;
    expect(winner.driverId).toBe(4469);
    expect(winner.carNumber).toBe("97");
    expect(winner.lapsLed).toBe(74);
    expect(drivers.find((d) => d.driverId === 4469)!.fullName).toBe("Shane Van Gisbergen");
  });
});

describe("normalizeCautions / normalizeRaceLeaders", () => {
  test("maps segments with race id", () => {
    const race = weekend.weekend_race[0]!;
    const cautions = normalizeCautions(race);
    expect(cautions.length).toBe(2);
    expect(cautions[0]!.raceId).toBe(5617);
    expect(cautions[0]!.startLap).toBeLessThanOrEqual(cautions[0]!.endLap);
    const leaders = normalizeRaceLeaders(race);
    expect(leaders.length).toBe(2);
    expect(leaders[0]!.carNumber).toBeTruthy();
  });
});

describe("normalizeLoopStats", () => {
  test("maps per-driver loop data", () => {
    const rows = normalizeLoopStats(loopStats);
    expect(rows.length).toBe(2);
    const svg = rows.find((r) => r.driverId === 4469)!;
    expect(svg.raceId).toBe(5617);
    expect(svg.finishPs).toBe(1);
    expect(svg.rating).toBeCloseTo(148.45);
    expect(svg.qualityPasses).toBe(12);
  });

  test("empty feed yields no rows", () => {
    expect(normalizeLoopStats([])).toEqual([]);
  });
});

describe("normalizeLapTimes", () => {
  test("flattens driver laps, parsing speed strings", () => {
    const rows = normalizeLapTimes(5617, lapTimes);
    expect(rows.length).toBe(8); // 2 drivers x 4 laps
    const lapZero = rows.find((r) => r.driverId === 4469 && r.lap === 0)!;
    expect(lapZero.lapTime).toBeNull();
    expect(lapZero.lapSpeed).toBeNull();
    const lapOne = rows.find((r) => r.driverId === 4469 && r.lap === 1)!;
    expect(lapOne.lapTime).toBeCloseTo(80.362);
    expect(lapOne.lapSpeed).toBeCloseTo(89.147);
    expect(typeof lapOne.runningPos).toBe("number");
  });
});

describe("coverage expectations", () => {
  test("loop stats expected from 2019 (earlier seasons null/403 on the CDN)", () => {
    expect(loopStatsExpected(2016)).toBe(false);
    expect(loopStatsExpected(2018)).toBe(false);
    expect(loopStatsExpected(2019)).toBe(true);
    expect(loopStatsExpected(2026)).toBe(true);
  });

  test("lap times expected from 2020", () => {
    expect(lapTimesExpected(2019)).toBe(false);
    expect(lapTimesExpected(2020)).toBe(true);
  });
});

describe("track classification", () => {
  test("Atlanta is intermediate before 2022, superspeedway after reprofile", () => {
    expect(trackTypeFor(111, 2021)).toBe("intermediate");
    expect(trackTypeFor(111, 2022)).toBe("superspeedway");
  });

  test("unknown tracks classify as unknown", () => {
    expect(trackTypeFor(99999, 2026)).toBe("unknown");
  });
});

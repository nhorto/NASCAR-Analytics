import { describe, expect, test } from "bun:test";
import {
  bucketOf,
  computeLiveMetrics,
  deriveAlerts,
  flagOf,
  normalizeFeed,
  passEfficiency,
  pitCycleModel,
  sumLapsLed,
} from "../src/domains/live/service.ts";
import type {
  LiveBaselines,
  LiveDriverRow,
  LiveFeed,
  LiveSnapshot,
} from "../src/domains/live/types.ts";
import liveFeed from "./fixtures/live-feed.json";

const feed = liveFeed as unknown as LiveFeed;

// ---- pure helpers ----

describe("live helpers", () => {
  test("flagOf decodes the CDN enum", () => {
    expect(flagOf(1)).toBe("green");
    expect(flagOf(2)).toBe("yellow");
    expect(flagOf(5)).toBe("checkered");
    expect(flagOf(9)).toBe("cold");
    expect(flagOf(99)).toBe("unknown");
  });

  test("bucketOf matches analytics bucketing (width 5)", () => {
    expect(bucketOf(1)).toBe(0);
    expect(bucketOf(5)).toBe(0);
    expect(bucketOf(6)).toBe(1);
    expect(bucketOf(8.03)).toBe(1);
    expect(bucketOf(11)).toBe(2);
  });

  test("passEfficiency is passes / encounters, null when none", () => {
    expect(passEfficiency(43, 24)).toBeCloseTo(43 / 67, 6);
    expect(passEfficiency(0, 0)).toBeNull();
  });

  test("sumLapsLed sums {start,end} ranges inclusively", () => {
    expect(
      sumLapsLed([
        { start_lap: 140, end_lap: 140 },
        { start_lap: 162, end_lap: 169 },
        { start_lap: 189, end_lap: 189 },
        { start_lap: 200, end_lap: 201 },
      ]),
    ).toBe(1 + 8 + 1 + 2); // 12
    expect(sumLapsLed(undefined)).toBe(0);
    expect(sumLapsLed([])).toBe(0);
  });
});

// ---- normalizeFeed against the real captured payload ----

describe("normalizeFeed (captured fixture)", () => {
  const snap = normalizeFeed(feed);

  test("top-level fields normalized", () => {
    expect(snap.raceId).toBe(5651);
    expect(snap.seriesId).toBe(2);
    expect(snap.flag).toBe("cold"); // flag_state 9
    expect(snap.isLive).toBe(false); // cold track = not a live session
    expect(snap.drivers.length).toBe(38);
  });

  test("drivers sorted by running order, leader gap 0", () => {
    expect(snap.drivers[0]!.position).toBe(1);
    expect(snap.drivers[0]!.gapToLeader).toBe(0);
    for (let i = 1; i < snap.drivers.length; i++) {
      expect(snap.drivers[i]!.position).toBeGreaterThanOrEqual(snap.drivers[i - 1]!.position);
    }
  });

  test("laps_led range array summed for a known car (Brandon Jones)", () => {
    const bj = snap.drivers.find((d) => d.driverId === 4085)!;
    expect(bj).toBeDefined();
    expect(bj.lapsLed).toBe(12);
    expect(bj.passesMade).toBe(43);
    expect(bj.timesPassed).toBe(24);
  });

  test("pit_stops count real stops, ignoring leading zero-padding entries", () => {
    // Brandon Jones' pit_stops = [0,0,0,0,0,48,94,134,157] → 4 real stops.
    const bj = snap.drivers.find((d) => d.driverId === 4085)!;
    expect(bj.pitStopCount).toBe(4);
    // Every car in this full-race snapshot has at least one real stop.
    expect(snap.drivers.every((d) => d.pitStopCount > 0)).toBe(true);
  });

  test("metric fields are null before computeLiveMetrics", () => {
    for (const d of snap.drivers) {
      expect(d.adjPassEfficiency).toBeNull();
      expect(d.livePassEfficiency).toBeNull();
    }
  });
});

// ---- computeLiveMetrics ----

describe("computeLiveMetrics", () => {
  const snap = normalizeFeed(feed);
  const baselines: LiveBaselines = {
    seriesId: 2,
    bucketWidth: 5,
    passEffByBucket: { "1": 0.5 },
    closerByBucket: { "1": 0.2 },
  };

  test("adjusted pass efficiency = (live − baseline) ×100 for the bucket", () => {
    const rows = computeLiveMetrics(snap, baselines);
    const bj = rows.find((d) => d.driverId === 4085)!; // avg run pos 8.03 → bucket 1
    expect(bj.livePassEfficiency).toBeCloseTo(43 / 67, 6);
    expect(bj.adjPassEfficiency).toBeCloseTo((43 / 67 - 0.5) * 100, 4);
  });

  test("closer estimate computes in the closing laps, null outside them", () => {
    // Fixture is lap 201/201 → within the final 10%.
    const closing = computeLiveMetrics(snap, baselines);
    const bj = closing.find((d) => d.driverId === 4085)!;
    expect(bj.closerEstimate).toBeCloseTo(bj.positionDiffLast10Pct - 0.2, 6);

    const early: LiveSnapshot = { ...snap, lap: 10 };
    const bjEarly = computeLiveMetrics(early, baselines).find((d) => d.driverId === 4085)!;
    expect(bjEarly.closerEstimate).toBeNull();
  });

  test("null baselines → null adjusted metric, raw pass efficiency still set", () => {
    const rows = computeLiveMetrics(snap, null);
    const bj = rows.find((d) => d.driverId === 4085)!;
    expect(bj.adjPassEfficiency).toBeNull();
    expect(bj.livePassEfficiency).toBeCloseTo(43 / 67, 6);
  });

  test("does not mutate the input snapshot", () => {
    computeLiveMetrics(snap, baselines);
    expect(snap.drivers.every((d) => d.adjPassEfficiency === null)).toBe(true);
  });
});

// ---- deriveAlerts (synthesized snapshots) ----

function mkDriver(over: Partial<LiveDriverRow> & { driverId: number; position: number }): LiveDriverRow {
  return {
    carNumber: String(over.position),
    driverName: `Driver ${over.driverId}`,
    manufacturer: null,
    gapToLeader: 0,
    lastLapSpeed: null,
    bestLapSpeed: null,
    avgRunningPosition: over.position,
    lapsLed: 0,
    lapsCompleted: 0,
    starting: null,
    passesMade: 0,
    timesPassed: 0,
    passingDifferential: 0,
    qualityPasses: 0,
    positionDiffLast10Pct: 0,
    fastestLapsRun: 0,
    pitStopCount: 0,
    isOnTrack: true,
    running: true,
    livePassEfficiency: null,
    adjPassEfficiency: null,
    closerEstimate: null,
    ...over,
  };
}

function mkSnap(over: Partial<LiveSnapshot> & { drivers: LiveDriverRow[] }): LiveSnapshot {
  return {
    raceId: 1,
    seriesId: 1,
    runName: "Test 400",
    trackName: "Test",
    trackLength: 1.5,
    lap: 100,
    lapsInRace: 200,
    lapsToGo: 100,
    elapsedTime: 0,
    flag: "green",
    flagState: 1,
    stage: { num: 1, finishAtLap: 60, lapsInStage: 60 },
    cautionSegments: 0,
    leadChanges: 0,
    numberOfLeaders: 1,
    isLive: true,
    ...over,
  };
}

describe("deriveAlerts", () => {
  test("null prev yields no events", () => {
    const next = mkSnap({ drivers: [mkDriver({ driverId: 1, position: 1 })] });
    expect(deriveAlerts(null, next)).toEqual([]);
  });

  test("lead change fires with the new leader", () => {
    const prev = mkSnap({
      drivers: [mkDriver({ driverId: 1, position: 1 }), mkDriver({ driverId: 2, position: 2 })],
    });
    const next = mkSnap({
      drivers: [mkDriver({ driverId: 2, position: 1 }), mkDriver({ driverId: 1, position: 2 })],
    });
    const lead = deriveAlerts(prev, next).filter((e) => e.kind === "lead_change");
    expect(lead).toHaveLength(1);
    expect(lead[0]!.driverId).toBe(2);
  });

  test("caution fires on green→yellow; green fires on yellow→green", () => {
    const green = mkSnap({ flag: "green", flagState: 1, drivers: [mkDriver({ driverId: 1, position: 1 })] });
    const yellow = mkSnap({ flag: "yellow", flagState: 2, drivers: [mkDriver({ driverId: 1, position: 1 })] });
    expect(deriveAlerts(green, yellow).some((e) => e.kind === "caution")).toBe(true);
    expect(deriveAlerts(yellow, green).some((e) => e.kind === "green")).toBe(true);
  });

  test("stage end fires when the stage number advances", () => {
    const prev = mkSnap({ stage: { num: 1, finishAtLap: 60, lapsInStage: 60 }, drivers: [mkDriver({ driverId: 1, position: 1 })] });
    const next = mkSnap({ stage: { num: 2, finishAtLap: 120, lapsInStage: 60 }, drivers: [mkDriver({ driverId: 1, position: 1 })] });
    expect(deriveAlerts(prev, next).some((e) => e.kind === "stage_end")).toBe(true);
  });

  test("big movers alert without focus; small moves stay quiet", () => {
    const prev = mkSnap({
      drivers: [mkDriver({ driverId: 1, position: 1 }), mkDriver({ driverId: 2, position: 10 }), mkDriver({ driverId: 3, position: 5 })],
    });
    const next = mkSnap({
      drivers: [mkDriver({ driverId: 1, position: 1 }), mkDriver({ driverId: 2, position: 4 }), mkDriver({ driverId: 3, position: 6 })],
    });
    const events = deriveAlerts(prev, next);
    expect(events.some((e) => e.kind === "position_gain" && e.driverId === 2)).toBe(true); // +6
    expect(events.some((e) => e.driverId === 3)).toBe(false); // only -1, below threshold
  });

  test("focus driver alerts on a small move that a non-focus driver would not", () => {
    const prev = mkSnap({ drivers: [mkDriver({ driverId: 7, position: 5 })] });
    const next = mkSnap({ drivers: [mkDriver({ driverId: 7, position: 4 })] });
    expect(deriveAlerts(prev, next).some((e) => e.driverId === 7)).toBe(false);
    expect(
      deriveAlerts(prev, next, { focusDriverIds: [7] }).some(
        (e) => e.kind === "position_gain" && e.driverId === 7,
      ),
    ).toBe(true);
  });

  test("pit and out transitions fire", () => {
    const prev = mkSnap({ drivers: [mkDriver({ driverId: 1, position: 3, pitStopCount: 1, running: true })] });
    const nextPit = mkSnap({ drivers: [mkDriver({ driverId: 1, position: 3, pitStopCount: 2, running: true })] });
    const nextOut = mkSnap({ drivers: [mkDriver({ driverId: 1, position: 3, pitStopCount: 1, running: false })] });
    expect(deriveAlerts(prev, nextPit).some((e) => e.kind === "pit")).toBe(true);
    expect(deriveAlerts(prev, nextOut).some((e) => e.kind === "out")).toBe(true);
  });
});

// ---- pitCycleModel ----

describe("pitCycleModel", () => {
  test("infers stint from consecutive green pit laps and projects the next stop", () => {
    const raw: LiveFeed = {
      race_id: 1,
      series_id: 1,
      lap_number: 95,
      laps_in_race: 200,
      laps_to_go: 105,
      elapsed_time: 0,
      flag_state: 1,
      vehicles: [
        {
          running_position: 1,
          vehicle_number: "5",
          driver: { driver_id: 100, full_name: "Test Driver" },
          delta: 0,
          average_running_position: 3,
          status: 1,
          is_on_track: true,
          pit_stops: [
            { pit_in_lap_count: 30 },
            { pit_in_lap_count: 70 },
          ],
        },
      ],
    };
    const snap = normalizeFeed(raw);
    const preds = pitCycleModel(snap, raw);
    expect(preds).toHaveLength(1);
    const p = preds[0]!;
    expect(p.lastGreenPitLap).toBe(70);
    expect(p.stintLength).toBe(40); // median gap between 30 and 70
    expect(p.lapsSincePit).toBe(95 - 70);
    expect(p.estimatedNextPitLap).toBe(70 + 40);
  });

  test("falls back to the default stint when a car has fewer than 2 stops", () => {
    const raw: LiveFeed = {
      race_id: 1,
      series_id: 1,
      lap_number: 50,
      laps_in_race: 200,
      laps_to_go: 150,
      elapsed_time: 0,
      flag_state: 1,
      vehicles: [
        {
          running_position: 1,
          vehicle_number: "9",
          driver: { driver_id: 200, full_name: "One Stop" },
          delta: 0,
          average_running_position: 2,
          status: 1,
          is_on_track: true,
          pit_stops: [{ pit_in_lap_count: 40 }],
        },
      ],
    };
    const snap = normalizeFeed(raw);
    const p = pitCycleModel(snap, raw)[0]!;
    expect(p.lastGreenPitLap).toBe(40);
    expect(p.stintLength).toBe(40); // DEFAULT_STINT_LAPS
    expect(p.estimatedNextPitLap).toBe(80);
  });
});

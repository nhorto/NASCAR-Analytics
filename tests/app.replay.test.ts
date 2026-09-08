// Unit coverage for the Phase 4 replay/soak driver (src/app/replay.ts):
//   - prepareRace turns an archived race into per-lap state (running order,
//     the real flag carried forward, green-flag loop counters).
//   - buildReplay emits the pre/race/post tick sequence the DO would see.
//   - runSoak's invariant checks actually catch a broken tick, not just pass
//     vacuously on a well-formed one.
import { describe, expect, test } from "bun:test";
import {
  buildReplay,
  prepareRace,
  runSoak,
  type ArchivedRace,
  type ReplayTick,
  type SoakDeps,
} from "../src/app/replay.ts";
import type { LiveFeed, LiveVehicle } from "../src/domains/live/types.ts";

// A tiny but fully-shaped archived race: 4 cars, 12 laps, one caution
// (laps 5-6), two stages (ends at lap 6 and 12), one retirement (car 3 after
// lap 8), and two real pit stops.
function syntheticRace(): ArchivedRace {
  const drivers = [
    { Number: "1", FullName: "Driver One", NASCARDriverID: 1 },
    { Number: "2", FullName: "Driver Two", NASCARDriverID: 2 },
    { Number: "3", FullName: "Driver Three", NASCARDriverID: 3 },
    { Number: "4", FullName: "Driver Four", NASCARDriverID: 4 },
  ];
  const laps = drivers.map((d, di) => ({
    ...d,
    Laps: Array.from({ length: 12 + 1 }, (_, lap) => {
      // Car 3 stops taking green-flag laps after lap 8 (retired).
      if (d.Number === "3" && lap > 8) return null;
      const pos = lap === 0 ? di + 1 : ((di + Math.floor(lap / 3)) % 4) + 1;
      return { Lap: lap, LapTime: lap === 0 ? null : 30 + di, LapSpeed: lap === 0 ? null : String(160 - di), RunningPos: pos };
    }).filter((l): l is NonNullable<typeof l> => l !== null),
  }));
  const flags = [
    { LapsCompleted: 0, FlagState: 8 },
    { LapsCompleted: 1, FlagState: 1 },
    { LapsCompleted: 5, FlagState: 2 }, // caution laps 5-6
    { LapsCompleted: 7, FlagState: 1 },
    { LapsCompleted: 12, FlagState: 5 }, // checkered
  ];
  return {
    weekend: {
      race_id: 999,
      series_id: 1,
      race_name: "Test 200",
      track_id: 1,
      track_name: "Test Speedway",
      scheduled_laps: 12,
      actual_laps: 12,
      stage_1_laps: 6,
      stage_2_laps: 6,
      results: [
        { driver_id: 1, starting_position: 1, finishing_status: "Running" },
        { driver_id: 2, starting_position: 2, finishing_status: "Running" },
        { driver_id: 3, starting_position: 3, finishing_status: "Accident" },
        { driver_id: 4, starting_position: 4, finishing_status: "Running" },
      ],
      caution_segments: [{ start_lap: 5, end_lap: 6 }],
      race_leaders: [
        { start_lap: 0, end_lap: 6, car_number: "1" },
        { start_lap: 7, end_lap: 12, car_number: "2" },
      ],
      pit_reports: [
        { vehicle_number: "1", lap_count: 4, pit_in_flag_status: 1 },
        { vehicle_number: "2", lap_count: 9, pit_in_flag_status: 1 },
      ],
    },
    lapTimes: { laps, flags },
  };
}

const trivialDeps: SoakDeps = {
  baselinesFor: () => null,
  strategyFor: () => null,
};

describe("prepareRace", () => {
  test("derives final lap, stage boundaries, and a carried-forward flag", () => {
    const prep = prepareRace(syntheticRace());
    expect(prep.finalLap).toBe(12);
    expect(prep.lapsInRace).toBe(12);
    expect(prep.stageBoundaries).toEqual([6, 12]);
    // Carried forward from the last known state (green at lap 1, through lap 4).
    expect(prep.flagByLap[4]).toBe(1);
    expect(prep.flagByLap[5]).toBe(2);
    expect(prep.flagByLap[6]).toBe(2);
    expect(prep.flagByLap[7]).toBe(1);
  });

  test("running order is unique 1..N every lap even after a retirement", () => {
    const prep = prepareRace(syntheticRace());
    for (let lap = 0; lap <= prep.finalLap; lap++) {
      const positions = [...prep.posByLap[lap]!].sort((a, b) => a - b);
      expect(positions).toEqual([1, 2, 3, 4]);
    }
  });
});

describe("buildReplay", () => {
  test("emits idle ticks, then one per lap, then idle ticks again", () => {
    const ticks = [...buildReplay(syntheticRace(), { idleTicks: 2 })];
    expect(ticks.slice(0, 2).every((t) => t.truth.phase === "pre")).toBe(true);
    expect(ticks.slice(-2).every((t) => t.truth.phase === "post")).toBe(true);
    const race = ticks.filter((t) => t.truth.phase === "race");
    expect(race.length).toBe(13); // laps 0..12
    expect(race[0]!.truth.lap).toBe(0);
    expect(race.at(-1)!.truth.lap).toBe(12);
    expect(ticks.length).toBe(2 + 13 + 2);
  });

  test('ticksPerLap "auto" repeats a lap enough times to span its real duration', () => {
    const ticks = [...buildReplay(syntheticRace(), { idleTicks: 0, ticksPerLap: "auto" })];
    // Every car's lap time here (30-33s) is several multiples of the 5s poll
    // cadence, so each real lap should be polled more than once.
    const repeatsForLap1 = ticks.filter((t) => t.truth.lap === 1).length;
    expect(repeatsForLap1).toBeGreaterThan(1);
  });

  test("truth carries the real flag/stage independent of the pipeline", () => {
    const ticks = [...buildReplay(syntheticRace(), { idleTicks: 0 })];
    const lap5 = ticks.find((t) => t.truth.lap === 5)!;
    expect(lap5.truth.flagState).toBe(2); // caution
    const lap7 = ticks.find((t) => t.truth.lap === 7)!;
    expect(lap7.truth.stageNum).toBe(2);
  });
});

describe("runSoak — happy path", () => {
  test("a well-formed replay produces zero violations and sane totals", () => {
    const ticks = buildReplay(syntheticRace(), { idleTicks: 1 });
    const report = runSoak(ticks, trivialDeps);
    expect(report.violations).toEqual([]);
    expect(report.race.raceId).toBe(999);
    expect(report.truth.cautionSegments).toBe(1);
    // deriveAlerts fires stage_end only when the stage NUMBER advances
    // (prev.stage.num < next.stage.num); with 2 stages there's exactly one
    // such transition (1→2) — the final stage never gets its own event
    // because there's no stage 3 to advance into. A real 3-stage race yields
    // 2 stage_end alerts for the same reason (see the `bun run soak` output).
    expect(report.truth.stageEnds).toBe(1);
    expect(report.truth.retirements).toBe(1);
    expect(report.truth.pitStops).toBe(2);
    expect(report.distinctLaps).toBe(13);
  });
});

// ---- fault injection: prove the invariant checks actually catch a broken tick ----

function baseVehicle(over: Partial<LiveVehicle>): LiveVehicle {
  return {
    running_position: 1,
    vehicle_number: "1",
    driver: { driver_id: 1, full_name: "Driver One" },
    delta: 0,
    average_running_position: 1,
    status: 1,
    is_on_track: true,
    ...over,
  };
}

function baseFeed(over: Partial<LiveFeed>): LiveFeed {
  return {
    race_id: 1,
    series_id: 1,
    lap_number: 10,
    laps_in_race: 50,
    laps_to_go: 40,
    elapsed_time: 300,
    flag_state: 1,
    vehicles: [
      baseVehicle({ running_position: 1, vehicle_number: "1", driver: { driver_id: 1, full_name: "A" } }),
      baseVehicle({ running_position: 2, vehicle_number: "2", driver: { driver_id: 2, full_name: "B" } }),
    ],
    ...over,
  };
}

function tick(feed: LiveFeed, truth: Partial<ReplayTick["truth"]> = {}): ReplayTick {
  return {
    feed,
    pitRecords: [],
    truth: { lap: feed.lap_number, flagState: feed.flag_state, stageNum: 0, repeat: 0, phase: "race", ...truth },
  };
}

describe("runSoak — invariant checks catch a broken tick", () => {
  test("running-order: a duplicate running_position is flagged", () => {
    const broken = baseFeed({
      vehicles: [
        baseVehicle({ running_position: 1, vehicle_number: "1", driver: { driver_id: 1, full_name: "A" } }),
        baseVehicle({ running_position: 1, vehicle_number: "2", driver: { driver_id: 2, full_name: "B" } }),
      ],
    });
    const report = runSoak([tick(broken)], trivialDeps);
    expect(report.violations.some((v) => v.check === "running-order")).toBe(true);
  });

  test("lap-identity: the snapshot lap must match the replay's ground truth", () => {
    const feed = baseFeed({ lap_number: 10 });
    const report = runSoak([tick(feed, { lap: 11 })], trivialDeps);
    expect(report.violations.some((v) => v.check === "lap-identity")).toBe(true);
  });

  test("liveness: payload.live must match the ground-truth flag's live-ness", () => {
    const cold = baseFeed({ flag_state: 9 }); // cold in the feed itself
    // Ground truth claims this lap was green — liveness should disagree with it.
    const report = runSoak([tick(cold, { flagState: 1 })], trivialDeps);
    expect(report.violations.some((v) => v.check === "liveness")).toBe(true);
  });

  test("duplicate-alerts: an unchanged lap must not re-fire an alert", () => {
    const t0 = tick(baseFeed({ lap_number: 10, vehicles: [
      baseVehicle({ running_position: 1, vehicle_number: "1", driver: { driver_id: 1, full_name: "A" } }),
      baseVehicle({ running_position: 2, vehicle_number: "2", driver: { driver_id: 2, full_name: "B" } }),
    ] }), { lap: 10, repeat: 0 });
    // Same lap (repeat > 0) but positions swapped — a real re-poll never
    // changes the feed, so this simulates the bug the check exists to catch.
    const t1 = tick(baseFeed({ lap_number: 10, vehicles: [
      baseVehicle({ running_position: 1, vehicle_number: "2", driver: { driver_id: 2, full_name: "B" } }),
      baseVehicle({ running_position: 2, vehicle_number: "1", driver: { driver_id: 1, full_name: "A" } }),
    ] }), { lap: 10, repeat: 1 });
    const report = runSoak([t0, t1], trivialDeps);
    expect(report.violations.some((v) => v.check === "duplicate-alerts")).toBe(true);
  });

  test("monotonic-pits: a car's pit count must never fall between ticks", () => {
    const withPit = baseFeed({
      lap_number: 10,
      vehicles: [baseVehicle({ pit_stops: [{ pit_in_lap_count: 4 }] })],
    });
    const withoutPit = baseFeed({
      lap_number: 11,
      vehicles: [baseVehicle({ pit_stops: [] })],
    });
    const report = runSoak([tick(withPit, { lap: 10 }), tick(withoutPit, { lap: 11 })], trivialDeps);
    expect(report.violations.some((v) => v.check === "monotonic-pits")).toBe(true);
  });
});

// Live-race REPLAY — reconstructs a full race from archived upstream JSON and
// drives it through the real live pipeline, tick by tick, so the companion can
// be soaked end-to-end without a live feed. This is the substitute the launch
// plan's risk table allows ("soak race can use a captured replay",
// docs/exec-plans/active/2026-09-07-production-and-paid-launch.md §10).
//
// Dev/ops tooling, NOT shipped to the edge. It reads two files the backfill
// already archived per race — `lap-times.json` (per-driver per-lap position,
// lap time and speed, plus the per-lap flag array) and `weekend-feed.json`
// (identity, stages, caution segments, race leaders, results, and — for ~a third
// of archived races — real `pit_reports`) — and rebuilds the `live-feed.json`
// shape the CDN would have served on every lap.
//
// What is REAL (straight from the archive): running order, lap times, lap
// speeds, the flag on every lap, caution segments, stage boundaries, lead
// changes, the field and its retirements, and pit-in laps with their flag state.
// What is RECONSTRUCTED (derived, and labelled as such in the report): the loop
// counters the live feed normally carries pre-computed — passes made/taken,
// quality passes, fastest laps, closing-lap differential — which we recompute
// from the real lap-by-lap position matrix using the same green-flag definition
// the loop data uses. Gaps to the leader come from cumulative lap times.
//
// The point is not to reproduce NASCAR's numbers exactly; it is to drive every
// state transition a race actually contains (green, 16 cautions, restarts, two
// stage ends, ~600 pit stops, retirements, the checkered, and the cold feed
// afterwards) through the pipeline that serves them.

import { liveConfig, liveRuntime, liveService } from "../domains/live/index.ts";
import type {
  LiveAlertEvent,
  LiveBaselines,
  LiveFeed,
  LiveHistory,
  LivePayload,
  LivePitRecord,
  LiveSnapshot,
  LiveVehicle,
  TrackStrategy,
} from "../domains/live/index.ts";

// ---- archived inputs (the two files the backfill stores per race) ----

/** One scored lap for one car, as archived in lap-times.json. */
export interface ArchivedLap {
  Lap: number;
  LapTime: number | null;
  /** Archived as a string ("168.020") — coerce before use. */
  LapSpeed: string | number | null;
  RunningPos: number;
}

export interface ArchivedDriverLaps {
  Number: string;
  FullName: string;
  Manufacturer?: string | null;
  NASCARDriverID: number;
  Laps: ArchivedLap[];
}

/** The real flag on each completed lap — the spine of the replay's timeline. */
export interface ArchivedFlag {
  LapsCompleted: number;
  FlagState: number;
}

export interface ArchivedLapTimes {
  laps: ArchivedDriverLaps[];
  flags: ArchivedFlag[];
}

export interface ArchivedResult {
  driver_id: number;
  car_number?: string | null;
  starting_position?: number | null;
  laps_completed?: number | null;
  finishing_status?: string | null;
  car_make?: string | null;
}

export interface ArchivedCaution {
  start_lap: number;
  end_lap: number;
}

export interface ArchivedLeader {
  start_lap: number;
  end_lap: number;
  car_number: string;
}

export interface ArchivedWeekendRace {
  race_id: number;
  series_id: number;
  race_name?: string | null;
  track_id?: number | null;
  track_name?: string | null;
  scheduled_laps?: number | null;
  actual_laps?: number | null;
  scheduled_distance?: number | null;
  stage_1_laps?: number | null;
  stage_2_laps?: number | null;
  stage_3_laps?: number | null;
  results?: ArchivedResult[];
  caution_segments?: ArchivedCaution[];
  race_leaders?: ArchivedLeader[];
  /** Real pit stops — present in roughly a third of archived races. */
  pit_reports?: LivePitRecord[];
}

/** Everything the replay needs for one race. */
export interface ArchivedRace {
  weekend: ArchivedWeekendRace;
  lapTimes: ArchivedLapTimes;
}

// ---- replay ticks ----

export interface ReplayOptions {
  /**
   * Polls per lap. "auto" derives it from the real lap time and the production
   * poll cadence, so the pipeline sees the SAME lap repeatedly exactly as the
   * Durable Object does between lap ticks — the case where duplicate alerts and
   * history double-appends would show up.
   */
  ticksPerLap?: number | "auto";
  /** Cold ticks emitted before the green and after the checkered. */
  idleTicks?: number;
}

export interface ReplayTick {
  feed: LiveFeed;
  /** live-pit-data.json rows visible at this lap (empty when unarchived). */
  pitRecords: LivePitRecord[];
  /** Ground truth for assertions — never derived from pipeline output. */
  truth: {
    lap: number;
    flagState: number;
    stageNum: number;
    /** Nth poll of this lap, 0-based; >0 means the lap has not advanced. */
    repeat: number;
    phase: "pre" | "race" | "post";
  };
}

const OUT_STATUS = 3; // any non-running code; see liveConfig.VEHICLE_STATUS_RUNNING

function toNum(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pre-computed per-lap race state. Built once so each tick is cheap and so the
 * running order is globally consistent (the archive's RunningPos goes stale for
 * lapped and retired cars, which would otherwise produce duplicate positions —
 * something the real feed never does).
 */
interface PreparedRace {
  race: ArchivedWeekendRace;
  drivers: ArchivedDriverLaps[];
  /** driver index → their laps keyed by lap number. */
  lapsByDriver: Array<Map<number, ArchivedLap>>;
  /** driver index → their last archived lap number. */
  lastLap: number[];
  /** driver index → cumulative elapsed seconds at each of their laps. */
  cumTime: Array<Map<number, number>>;
  /** lap → driver index → position (re-ranked, unique, 1..N). */
  posByLap: Array<Int16Array>;
  /** lap → the real flag state. */
  flagByLap: Int16Array;
  /** lap → race elapsed seconds (the leader's clock). */
  elapsedByLap: Float64Array;
  /** driver index → per-lap running loop counters. */
  loop: Array<{
    passes: Int32Array;
    passed: Int32Array;
    quality: Int32Array;
    fastest: Int32Array;
    improved: Int32Array;
    bestTime: Float64Array;
    bestSpeed: Float64Array;
    avgSpeed: Float64Array;
    avgPos: Float64Array;
  }>;
  /** driver index → their result row. */
  resultOf: Array<ArchivedResult | undefined>;
  /** car number → sorted real pit-in laps. */
  pitLapsByCar: Map<string, number[]>;
  lapsInRace: number;
  finalLap: number;
  stageBoundaries: number[]; // cumulative finish-at laps, e.g. [105, 210, 334]
  trackLength: number | null;
}

/** Cars are ranked by laps completed, then their scored position, then clock. */
function rankLap(
  lap: number,
  drivers: ArchivedDriverLaps[],
  lapsByDriver: Array<Map<number, ArchivedLap>>,
  lastLap: number[],
  cumTime: Array<Map<number, number>>,
): Int16Array {
  const order = drivers.map((_, i) => {
    const own = Math.min(lap, lastLap[i] ?? 0);
    const entry = lapsByDriver[i]!.get(own);
    return {
      i,
      own,
      pos: entry?.RunningPos ?? 999,
      clock: cumTime[i]!.get(own) ?? Number.MAX_SAFE_INTEGER,
    };
  });
  order.sort(
    (a, b) => b.own - a.own || a.pos - b.pos || a.clock - b.clock || a.i - b.i,
  );
  const out = new Int16Array(drivers.length);
  for (let p = 0; p < order.length; p++) out[order[p]!.i] = p + 1;
  return out;
}

export function prepareRace(race: ArchivedRace): PreparedRace {
  const weekend = race.weekend;
  const drivers = (race.lapTimes.laps ?? []).filter((d) => Array.isArray(d.Laps));
  const n = drivers.length;

  const flagsRaw = race.lapTimes.flags ?? [];
  const finalLap = Math.max(
    0,
    ...flagsRaw.map((f) => toNum(f.LapsCompleted) ?? 0),
    ...drivers.map((d) => (d.Laps.length ? (toNum(d.Laps[d.Laps.length - 1]!.Lap) ?? 0) : 0)),
  );
  const lapsInRace = toNum(weekend.scheduled_laps) ?? toNum(weekend.actual_laps) ?? finalLap;

  const lapsByDriver: Array<Map<number, ArchivedLap>> = [];
  const lastLap: number[] = [];
  const cumTime: Array<Map<number, number>> = [];
  for (const d of drivers) {
    const m = new Map<number, ArchivedLap>();
    const c = new Map<number, number>();
    let acc = 0;
    let last = 0;
    for (const l of d.Laps) {
      const lap = toNum(l.Lap);
      if (lap == null) continue;
      m.set(lap, l);
      acc += toNum(l.LapTime) ?? 0;
      c.set(lap, acc);
      if (lap > last) last = lap;
    }
    lapsByDriver.push(m);
    cumTime.push(c);
    lastLap.push(last);
  }

  // Real flag per lap, carried forward across any gaps in the archive.
  const flagByLap = new Int16Array(finalLap + 1);
  {
    const byLap = new Map<number, number>();
    for (const f of flagsRaw) {
      const lap = toNum(f.LapsCompleted);
      const st = toNum(f.FlagState);
      if (lap != null && st != null) byLap.set(lap, st);
    }
    let carry = 8; // "hot" — pre-race
    for (let lap = 0; lap <= finalLap; lap++) {
      carry = byLap.get(lap) ?? carry;
      flagByLap[lap] = carry;
    }
  }

  const posByLap: Array<Int16Array> = [];
  for (let lap = 0; lap <= finalLap; lap++) {
    posByLap.push(rankLap(lap, drivers, lapsByDriver, lastLap, cumTime));
  }

  // Race clock = the leader's cumulative time at each lap.
  const elapsedByLap = new Float64Array(finalLap + 1);
  for (let lap = 1; lap <= finalLap; lap++) {
    let leaderIdx = 0;
    for (let i = 0; i < n; i++) if (posByLap[lap]![i] === 1) leaderIdx = i;
    elapsedByLap[lap] = cumTime[leaderIdx]!.get(Math.min(lap, lastLap[leaderIdx] ?? 0)) ?? elapsedByLap[lap - 1]!;
  }

  // Per-lap loop counters, accumulated forward. Passes only count under green,
  // matching the loop-data definition of a green-flag pass.
  const loop = drivers.map(() => ({
    passes: new Int32Array(finalLap + 1),
    passed: new Int32Array(finalLap + 1),
    quality: new Int32Array(finalLap + 1),
    fastest: new Int32Array(finalLap + 1),
    improved: new Int32Array(finalLap + 1),
    bestTime: new Float64Array(finalLap + 1),
    bestSpeed: new Float64Array(finalLap + 1),
    avgSpeed: new Float64Array(finalLap + 1),
    avgPos: new Float64Array(finalLap + 1),
  }));
  const speedSum = new Float64Array(n);
  const speedCount = new Int32Array(n);
  const posSum = new Float64Array(n);
  const posCount = new Int32Array(n);
  for (let lap = 1; lap <= finalLap; lap++) {
    const green = flagByLap[lap] === 1 && flagByLap[lap - 1] === 1;
    // Fastest lap of the field on this lap.
    let fastestIdx = -1;
    let fastestTime = Infinity;
    for (let i = 0; i < n; i++) {
      const e = lapsByDriver[i]!.get(lap);
      const t = e ? toNum(e.LapTime) : null;
      if (t != null && t > 0 && t < fastestTime) {
        fastestTime = t;
        fastestIdx = i;
      }
    }
    for (let i = 0; i < n; i++) {
      const L = loop[i]!;
      const prevPos = posByLap[lap - 1]![i]!;
      const pos = posByLap[lap]![i]!;
      const moved = prevPos - pos; // + = gained
      const scored = lapsByDriver[i]!.has(lap);
      L.passes[lap] = L.passes[lap - 1]! + (green && moved > 0 ? moved : 0);
      L.passed[lap] = L.passed[lap - 1]! + (green && moved < 0 ? -moved : 0);
      L.quality[lap] = L.quality[lap - 1]! + (green && moved > 0 && pos <= 15 ? moved : 0);
      L.improved[lap] = L.improved[lap - 1]! + (moved > 0 ? 1 : 0);
      L.fastest[lap] = L.fastest[lap - 1]! + (i === fastestIdx ? 1 : 0);

      const e = scored ? lapsByDriver[i]!.get(lap) : undefined;
      const t = e ? toNum(e.LapTime) : null;
      const s = e ? toNum(e.LapSpeed) : null;
      const prevBestTime = L.bestTime[lap - 1]!;
      L.bestTime[lap] = t != null && t > 0 && (prevBestTime === 0 || t < prevBestTime) ? t : prevBestTime;
      L.bestSpeed[lap] = s != null && s > L.bestSpeed[lap - 1]! ? s : L.bestSpeed[lap - 1]!;
      if (s != null && s > 0) {
        speedSum[i] = speedSum[i]! + s;
        speedCount[i]! += 1;
      }
      L.avgSpeed[lap] = speedCount[i]! ? speedSum[i]! / speedCount[i]! : 0;
      posSum[i] = posSum[i]! + pos;
      posCount[i]! += 1;
      L.avgPos[lap] = posSum[i]! / posCount[i]!;
    }
  }

  const resultOf = drivers.map((d) =>
    (weekend.results ?? []).find((r) => Number(r.driver_id) === Number(d.NASCARDriverID)),
  );

  const pitLapsByCar = new Map<string, number[]>();
  for (const p of weekend.pit_reports ?? []) {
    const lap = toNum(p.lap_count) ?? 0;
    if (lap <= 0) continue;
    const car = String(p.vehicle_number ?? "");
    const arr = pitLapsByCar.get(car) ?? [];
    arr.push(lap);
    pitLapsByCar.set(car, arr);
  }
  for (const arr of pitLapsByCar.values()) arr.sort((a, b) => a - b);

  const s1 = toNum(weekend.stage_1_laps) ?? 0;
  const s2 = toNum(weekend.stage_2_laps) ?? 0;
  const s3 = toNum(weekend.stage_3_laps) ?? 0;
  const stageBoundaries: number[] = [];
  if (s1 > 0) stageBoundaries.push(s1);
  if (s2 > 0) stageBoundaries.push(s1 + s2);
  if (s3 > 0) stageBoundaries.push(s1 + s2 + s3);

  const dist = toNum(weekend.scheduled_distance);
  const trackLength = dist && lapsInRace > 0 ? Number((dist / lapsInRace).toFixed(3)) : null;

  return {
    race: weekend,
    drivers,
    lapsByDriver,
    lastLap,
    cumTime,
    posByLap,
    flagByLap,
    elapsedByLap,
    loop,
    resultOf,
    pitLapsByCar,
    lapsInRace,
    finalLap,
    stageBoundaries,
    trackLength,
  };
}

/** Which stage the race is in once `lap` is complete (1-based; 0 = no stages). */
function stageNumAt(prep: PreparedRace, lap: number): number {
  if (!prep.stageBoundaries.length) return 0;
  for (let i = 0; i < prep.stageBoundaries.length; i++) {
    if (lap < prep.stageBoundaries[i]!) return i + 1;
  }
  return prep.stageBoundaries.length;
}

function buildFeed(prep: PreparedRace, lap: number, flagState: number): LiveFeed {
  const n = prep.drivers.length;
  const closingLap = Math.floor(0.9 * prep.lapsInRace);
  const vehicles: LiveVehicle[] = [];

  let leaderIdx = 0;
  for (let i = 0; i < n; i++) if (prep.posByLap[lap]![i] === 1) leaderIdx = i;
  const leaderOwn = Math.min(lap, prep.lastLap[leaderIdx] ?? 0);
  const leaderClock = prep.cumTime[leaderIdx]!.get(leaderOwn) ?? 0;
  const avgLapTime = lap > 0 ? leaderClock / Math.max(1, leaderOwn) : 0;

  for (let i = 0; i < n; i++) {
    const d = prep.drivers[i]!;
    const own = Math.min(lap, prep.lastLap[i] ?? 0);
    const entry = prep.lapsByDriver[i]!.get(own);
    const result = prep.resultOf[i];
    const status = String(result?.finishing_status ?? "Running");
    // A car with no further scored laps and a non-Running status has retired.
    const out = lap > (prep.lastLap[i] ?? 0) && status !== "Running";
    const L = prep.loop[i]!;

    const clock = prep.cumTime[i]!.get(own) ?? leaderClock;
    const lapsDown = Math.max(0, leaderOwn - own);
    const delta = i === leaderIdx ? 0 : Number((clock - leaderClock + lapsDown * avgLapTime).toFixed(3));

    // The CDN zero-pads pit_stops at the front, then lists real pit-in laps.
    const car = String(d.Number ?? "");
    const realPits = (prep.pitLapsByCar.get(car) ?? []).filter((l) => l <= lap);
    const pitStops = [
      ...[0, 0, 0].map(() => ({ pit_in_lap_count: 0 })),
      ...realPits.map((l) => ({ pit_in_lap_count: l })),
    ];

    const closingDiff =
      lap >= closingLap && closingLap > 0
        ? (prep.posByLap[closingLap]![i] ?? 0) - (prep.posByLap[lap]![i] ?? 0)
        : 0;

    vehicles.push({
      running_position: prep.posByLap[lap]![i]!,
      vehicle_number: car,
      driver: { driver_id: d.NASCARDriverID, full_name: d.FullName },
      delta,
      last_lap_time: entry ? (toNum(entry.LapTime) ?? undefined) : undefined,
      last_lap_speed: entry ? (toNum(entry.LapSpeed) ?? undefined) : undefined,
      best_lap_time: L.bestTime[lap]! > 0 ? L.bestTime[lap]! : undefined,
      best_lap_speed: L.bestSpeed[lap]! > 0 ? L.bestSpeed[lap]! : undefined,
      average_speed: L.avgSpeed[lap]! > 0 ? Number(L.avgSpeed[lap]!.toFixed(3)) : undefined,
      average_running_position: Number((L.avgPos[lap] || prep.posByLap[lap]![i]!).toFixed(3)),
      laps_completed: own,
      laps_led: lapLedRanges(prep, car, lap),
      passes_made: L.passes[lap]!,
      times_passed: L.passed[lap]!,
      passing_differential: L.passes[lap]! - L.passed[lap]!,
      quality_passes: L.quality[lap]!,
      position_differential_last_10_percent: closingDiff,
      fastest_laps_run: L.fastest[lap]!,
      laps_position_improved: L.improved[lap]!,
      pit_stops: pitStops,
      is_on_track: !out,
      status: out ? OUT_STATUS : liveConfig.VEHICLE_STATUS_RUNNING,
      starting_position: toNum(result?.starting_position) ?? undefined,
      vehicle_manufacturer: d.Manufacturer ?? result?.car_make ?? undefined,
    });
  }
  vehicles.sort((a, b) => a.running_position - b.running_position);

  const leaders = (prep.race.race_leaders ?? []).filter((l) => (toNum(l.start_lap) ?? 0) <= lap);
  const cautions = (prep.race.caution_segments ?? []).filter((c) => (toNum(c.start_lap) ?? 0) <= lap);
  const cautionLaps = cautions.reduce((sum, c) => {
    const start = toNum(c.start_lap) ?? 0;
    const end = Math.min(toNum(c.end_lap) ?? start, lap);
    return sum + Math.max(0, end - start + 1);
  }, 0);

  const stageNum = stageNumAt(prep, lap);
  const stage =
    stageNum > 0
      ? {
          stage_num: stageNum,
          finish_at_lap: prep.stageBoundaries[stageNum - 1]!,
          laps_in_stage:
            prep.stageBoundaries[stageNum - 1]! - (stageNum > 1 ? prep.stageBoundaries[stageNum - 2]! : 0),
        }
      : null;

  return {
    race_id: prep.race.race_id,
    series_id: prep.race.series_id,
    run_name: prep.race.race_name ?? undefined,
    run_type: 3,
    track_id: toNum(prep.race.track_id) ?? undefined,
    track_name: prep.race.track_name ?? undefined,
    track_length: prep.trackLength ?? undefined,
    lap_number: lap,
    laps_in_race: prep.lapsInRace,
    laps_to_go: Math.max(0, prep.lapsInRace - lap),
    elapsed_time: Number((prep.elapsedByLap[lap] ?? 0).toFixed(3)),
    flag_state: flagState,
    number_of_caution_segments: cautions.length,
    number_of_caution_laps: cautionLaps,
    number_of_lead_changes: Math.max(0, leaders.length - 1),
    number_of_leaders: new Set(leaders.map((l) => String(l.car_number))).size,
    stage,
    vehicles,
  };
}

function lapLedRanges(prep: PreparedRace, car: string, lap: number) {
  const out: Array<{ start_lap: number; end_lap: number }> = [];
  for (const l of prep.race.race_leaders ?? []) {
    if (String(l.car_number) !== car) continue;
    const start = toNum(l.start_lap) ?? 0;
    if (start > lap) continue;
    out.push({ start_lap: start, end_lap: Math.min(toNum(l.end_lap) ?? start, lap) });
  }
  return out;
}

/**
 * The whole race as the pipeline would have seen it: cold ticks, then every lap
 * (polled as often as the DO really would), the checkered, and cold ticks after.
 */
export function* buildReplay(race: ArchivedRace, opts: ReplayOptions = {}): Generator<ReplayTick> {
  const prep = prepareRace(race);
  const idleTicks = opts.idleTicks ?? 2;
  const mode = opts.ticksPerLap ?? 1;

  const coldFeed = (lap: number, flag: number): LiveFeed => ({
    ...buildFeed(prep, lap, flag),
    // A cold feed carries the field but no live counters worth trusting.
    number_of_lead_changes: 0,
  });

  for (let i = 0; i < idleTicks; i++) {
    yield {
      feed: coldFeed(0, 9), // cold
      pitRecords: [],
      truth: { lap: 0, flagState: 9, stageNum: stageNumAt(prep, 0), repeat: i, phase: "pre" },
    };
  }

  const pitReports = prep.race.pit_reports ?? [];
  for (let lap = 0; lap <= prep.finalLap; lap++) {
    const flagState = prep.flagByLap[lap]!;
    const lapTime = lap > 0 ? (prep.elapsedByLap[lap]! - prep.elapsedByLap[lap - 1]!) : 0;
    const repeats =
      mode === "auto"
        ? Math.max(1, Math.min(20, Math.round(lapTime / (liveConfig.POLL_INTERVAL_MS / 1000)) || 1))
        : Math.max(1, mode);
    const feed = buildFeed(prep, lap, flagState);
    const pitRecords = pitReports.filter((p) => (toNum(p.lap_count) ?? 0) <= lap);
    for (let r = 0; r < repeats; r++) {
      yield {
        feed,
        pitRecords,
        truth: { lap, flagState, stageNum: stageNumAt(prep, lap), repeat: r, phase: "race" },
      };
    }
  }

  for (let i = 0; i < idleTicks; i++) {
    yield {
      feed: coldFeed(prep.finalLap, 9),
      pitRecords: pitReports,
      truth: {
        lap: prep.finalLap,
        flagState: 9,
        stageNum: stageNumAt(prep, prep.finalLap),
        repeat: i,
        phase: "post",
      },
    };
  }
}

// ---- soak ----
//
// Drives the replay through the SAME composition the Durable Object runs each
// tick (canonicalize → processFeed → persist prev snapshot / alerts / history),
// asserting the invariants the UI depends on and measuring the things that only
// a full race exposes: alert volume under a caution pit cycle, history growth,
// payload size, and per-tick cost. The Cloudflare-specific pieces are injected
// so this stays importable from Bun and from the tests.

export interface SoakDeps {
  /** worker/canonicalize.ts — schedule-backed feed identity. Optional. */
  canonicalize?: (feed: LiveFeed) => LiveFeed;
  /** worker/baselines.ts lookup. */
  baselinesFor: (seriesId: number) => LiveBaselines | null;
  /** worker/track-strategy.ts lookup. */
  strategyFor: (seriesId: number, trackId: number) => TrackStrategy | null;
  /** Must match the Worker's MAX_ALERTS. */
  maxAlerts?: number;
}

export interface SoakViolation {
  tick: number;
  lap: number;
  check: string;
  detail: string;
}

export interface SoakReport {
  race: {
    raceId: number;
    seriesId: number;
    name: string | null;
    track: string | null;
    lapsInRace: number;
    finalLap: number;
    cars: number;
  };
  ticks: number;
  distinctLaps: number;
  wallMs: number;
  tickMs: { p50: number; p95: number; max: number };
  payloadBytes: { p50: number; max: number };
  alerts: {
    derived: number;
    byKind: Record<string, number>;
    maxPerTick: number;
    maxPerTickLap: number;
    /** Ticks a global (race-wide) alert survived in the served feed. */
    globalLifetimeTicks: { min: number; median: number; evictedImmediately: number };
  };
  truth: {
    cautionSegments: number;
    stageEnds: number;
    leadChanges: number;
    retirements: number;
    pitStops: number;
  };
  coverage: {
    /** Peak share of the field carrying each live metric. */
    passEfficiency: number;
    adjPassEfficiency: number;
    closerEstimate: number;
    trends: number;
    pitCycleSource: string;
  };
  violations: SoakViolation[];
}

/** Depth-first scan for values JSON cannot represent (NaN / ±Infinity). */
function findNonFinite(value: unknown, path = "$"): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : `${path}=${value}`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findNonFinite(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const hit = findNonFinite(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

const GLOBAL_KINDS = new Set(["caution", "green", "stage_end", "lead_change"]);

function alertKey(a: LiveAlertEvent): string {
  return `${a.kind}|${a.atLap}|${a.driverId ?? "-"}|${a.message}`;
}

export function runSoak(ticks: Iterable<ReplayTick>, deps: SoakDeps): SoakReport {
  const maxAlerts = deps.maxAlerts ?? 40;
  const violations: SoakViolation[] = [];
  const add = (tick: number, lap: number, check: string, detail: string) => {
    // Cap per check so one systemic fault cannot bury the rest of the report.
    if (violations.filter((v) => v.check === check).length < 5) {
      violations.push({ tick, lap, check, detail });
    }
  };

  // Durable Object state, round-tripped through JSON each tick exactly as
  // storage would, so anything unserializable surfaces here and not in prod.
  let prevSnapshot: LiveSnapshot | null = null;
  let prevAlerts: LiveAlertEvent[] = [];
  let prevHistory: LiveHistory | null = null;

  const tickMs: number[] = [];
  const payloadBytes: number[] = [];
  const byKind: Record<string, number> = {};
  let derived = 0;
  let maxPerTick = 0;
  let maxPerTickLap = 0;
  const laps = new Set<number>();
  // Global alert key → { firstTick, lastSeenTick }.
  const globalLife = new Map<string, { first: number; last: number }>();
  const monotonic = new Map<number, { pits: number; led: number; passes: number }>();
  const coverage = { pe: 0, adj: 0, closer: 0, trends: 0 };
  let pitCycleSource = "none";
  let retirements = 0;
  const seenOut = new Set<number>();

  let race: SoakReport["race"] | null = null;
  let truthCautions = 0;
  let truthStageEnds = 0;
  let truthLeadChanges = 0;
  let truthPitStops = 0;

  const started = Date.now();
  let index = -1;
  for (const tick of ticks) {
    index++;
    const feed = deps.canonicalize ? deps.canonicalize(tick.feed) : tick.feed;
    const baselines = deps.baselinesFor(feed.series_id);
    const trackStrategy = deps.strategyFor(feed.series_id, feed.track_id ?? 0);
    const pitStops = liveService.pitStopsFromLivePitData(tick.pitRecords);

    const t0 = performance.now();
    const result = liveRuntime.processFeed(feed, {
      baselines,
      prevSnapshot,
      prevAlerts,
      prevHistory,
      pitStops,
      trackStrategy,
      maxAlerts,
      fetchedAt: Date.now(),
    });
    tickMs.push(performance.now() - t0);

    const { payload, snapshot, history, newAlerts } = result;
    const lap = snapshot.lap;
    laps.add(lap);

    if (!race) {
      race = {
        raceId: snapshot.raceId,
        seriesId: snapshot.seriesId,
        name: snapshot.runName,
        track: snapshot.trackName,
        lapsInRace: snapshot.lapsInRace,
        finalLap: 0,
        cars: snapshot.drivers.length,
      };
    }
    race.finalLap = Math.max(race.finalLap, lap);
    truthCautions = Math.max(truthCautions, snapshot.cautionSegments);
    truthLeadChanges = Math.max(truthLeadChanges, snapshot.leadChanges);
    truthPitStops = Math.max(truthPitStops, pitStops.length);

    // ---- invariants ----

    const nonFinite = findNonFinite(payload);
    if (nonFinite) add(index, lap, "finite-numbers", `non-finite value at ${nonFinite}`);

    const serialized = JSON.stringify(payload);
    payloadBytes.push(serialized.length);
    if (serialized.includes("null,null,null,null,null,null,null,null")) {
      // Cheap canary for an accidentally sparse array in the payload.
      add(index, lap, "sparse-array", "payload contains a long run of nulls");
    }

    for (let i = 0; i < snapshot.drivers.length; i++) {
      const d = snapshot.drivers[i]!;
      if (d.position !== i + 1) {
        add(index, lap, "running-order", `index ${i} holds P${d.position} (expected P${i + 1})`);
        break;
      }
    }
    const leader = snapshot.drivers[0];
    if (leader && leader.position === 1 && leader.gapToLeader !== 0) {
      add(index, lap, "leader-gap", `leader gap is ${leader.gapToLeader}, expected 0`);
    }

    if (payload.alerts.length > maxAlerts) {
      add(index, lap, "alert-cap", `${payload.alerts.length} alerts exceeds cap ${maxAlerts}`);
    }
    for (let i = 1; i < payload.alerts.length; i++) {
      if (payload.alerts[i]!.atLap > payload.alerts[i - 1]!.atLap) {
        add(index, lap, "alert-order", "alert feed is not newest-first by lap");
        break;
      }
    }

    if (history.frames.length > liveConfig.HISTORY_LAPS) {
      add(index, lap, "history-cap", `${history.frames.length} frames exceeds ${liveConfig.HISTORY_LAPS}`);
    }
    for (let i = 1; i < history.frames.length; i++) {
      if (history.frames[i]!.lap <= history.frames[i - 1]!.lap) {
        add(index, lap, "history-order", "history frames are not strictly increasing in lap");
        break;
      }
    }

    // Re-polling the SAME lap must not re-fire alerts or re-append history.
    if (tick.truth.repeat > 0 && newAlerts.length > 0) {
      add(
        index,
        lap,
        "duplicate-alerts",
        `${newAlerts.length} alert(s) re-fired on an unchanged lap (${newAlerts.map((a) => a.kind).join(",")})`,
      );
    }

    for (const p of payload.pitCycles) {
      if (p.lapsToTypicalPit != null && p.lapsToTypicalPit < 0) {
        add(index, lap, "pit-window", `car ${p.carNumber} lapsToTypicalPit ${p.lapsToTypicalPit}`);
      }
      if (p.lastGreenPitLap != null && p.estimatedNextPitLap != null && p.estimatedNextPitLap <= p.lastGreenPitLap) {
        add(index, lap, "pit-window", `car ${p.carNumber} next pit ${p.estimatedNextPitLap} <= last ${p.lastGreenPitLap}`);
      }
    }
    if (payload.pitCycles.length) pitCycleSource = payload.pitCycles[0]!.source;

    if (tick.truth.phase === "race" && snapshot.lap !== tick.truth.lap) {
      add(index, lap, "lap-identity", `snapshot lap ${snapshot.lap} != replay lap ${tick.truth.lap}`);
    }
    const expectedLive = liveConfig.LIVE_FLAG_STATES.has(liveService.flagOf(tick.truth.flagState));
    if (payload.live !== expectedLive) {
      add(index, lap, "liveness", `live=${payload.live} for flag ${tick.truth.flagState}`);
    }

    const present = new Set(snapshot.drivers.map((d) => d.driverId));
    for (const m of [...payload.movers.gaining, ...payload.movers.fading]) {
      if (!present.has(m.driverId)) add(index, lap, "mover-identity", `mover ${m.driverId} not in field`);
    }
    for (const b of payload.battles) {
      if (!present.has(b.aId) || !present.has(b.bId)) {
        add(index, lap, "battle-identity", `battle ${b.aId}/${b.bId} not in field`);
      }
      if (b.gap > liveConfig.BATTLE_GAP_SECONDS + 1e-9) {
        add(index, lap, "battle-gap", `gap ${b.gap} exceeds ${liveConfig.BATTLE_GAP_SECONDS}`);
      }
    }

    for (const d of snapshot.drivers) {
      const seen = monotonic.get(d.driverId);
      if (seen) {
        if (d.pitStopCount < seen.pits) {
          add(index, lap, "monotonic-pits", `car ${d.carNumber} pit count fell ${seen.pits}→${d.pitStopCount}`);
        }
        if (d.lapsLed < seen.led) {
          add(index, lap, "monotonic-led", `car ${d.carNumber} laps led fell ${seen.led}→${d.lapsLed}`);
        }
        if (d.passesMade < seen.passes) {
          add(index, lap, "monotonic-passes", `car ${d.carNumber} passes fell ${seen.passes}→${d.passesMade}`);
        }
      }
      monotonic.set(d.driverId, {
        pits: Math.max(seen?.pits ?? 0, d.pitStopCount),
        led: Math.max(seen?.led ?? 0, d.lapsLed),
        passes: Math.max(seen?.passes ?? 0, d.passesMade),
      });
      if (!d.running && !seenOut.has(d.driverId)) {
        seenOut.add(d.driverId);
        retirements++;
      }
    }

    // ---- measurements ----

    const field = Math.max(1, snapshot.drivers.length);
    coverage.pe = Math.max(coverage.pe, snapshot.drivers.filter((d) => d.livePassEfficiency != null).length / field);
    coverage.adj = Math.max(coverage.adj, snapshot.drivers.filter((d) => d.adjPassEfficiency != null).length / field);
    coverage.closer = Math.max(coverage.closer, snapshot.drivers.filter((d) => d.closerEstimate != null).length / field);
    coverage.trends = Math.max(
      coverage.trends,
      snapshot.drivers.filter((d) => (d.segments?.length ?? 0) > 0).length / field,
    );

    derived += newAlerts.length;
    for (const a of newAlerts) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    if (newAlerts.length > maxPerTick) {
      maxPerTick = newAlerts.length;
      maxPerTickLap = lap;
    }
    truthStageEnds += newAlerts.filter((a) => a.kind === "stage_end").length;

    for (const a of payload.alerts) {
      if (!GLOBAL_KINDS.has(a.kind)) continue;
      const key = alertKey(a);
      const life = globalLife.get(key);
      if (life) life.last = index;
      else globalLife.set(key, { first: index, last: index });
    }

    // Persist as the DO does — through JSON, so a non-serializable value fails here.
    prevSnapshot = JSON.parse(JSON.stringify(snapshot)) as LiveSnapshot;
    prevAlerts = JSON.parse(JSON.stringify(payload.alerts)) as LiveAlertEvent[];
    prevHistory = JSON.parse(JSON.stringify(history)) as LiveHistory;
  }

  const lifetimes = [...globalLife.values()].map((v) => v.last - v.first + 1).sort((a, b) => a - b);
  const sortedTick = [...tickMs].sort((a, b) => a - b);
  const sortedBytes = [...payloadBytes].sort((a, b) => a - b);

  return {
    race: race ?? {
      raceId: 0,
      seriesId: 0,
      name: null,
      track: null,
      lapsInRace: 0,
      finalLap: 0,
      cars: 0,
    },
    ticks: index + 1,
    distinctLaps: laps.size,
    wallMs: Date.now() - started,
    tickMs: {
      p50: Number(percentile(sortedTick, 50).toFixed(3)),
      p95: Number(percentile(sortedTick, 95).toFixed(3)),
      max: Number((sortedTick[sortedTick.length - 1] ?? 0).toFixed(3)),
    },
    payloadBytes: {
      p50: percentile(sortedBytes, 50),
      max: sortedBytes[sortedBytes.length - 1] ?? 0,
    },
    alerts: {
      derived,
      byKind,
      maxPerTick,
      maxPerTickLap,
      globalLifetimeTicks: {
        min: lifetimes[0] ?? 0,
        median: percentile(lifetimes, 50),
        evictedImmediately: lifetimes.filter((l) => l <= 1).length,
      },
    },
    truth: {
      cautionSegments: truthCautions,
      stageEnds: truthStageEnds,
      leadChanges: truthLeadChanges,
      retirements,
      pitStops: truthPitStops,
    },
    coverage: {
      passEfficiency: Number(coverage.pe.toFixed(3)),
      adjPassEfficiency: Number(coverage.adj.toFixed(3)),
      closerEstimate: Number(coverage.closer.toFixed(3)),
      trends: Number(coverage.trends.toFixed(3)),
      pitCycleSource,
    },
    violations,
  };
}

export function formatSoakReport(r: SoakReport): string {
  const lines: string[] = [];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  lines.push(`Race      ${r.race.name ?? "?"} (${r.race.raceId}) · ${r.race.track ?? "?"} · series ${r.race.seriesId}`);
  lines.push(`Field     ${r.race.cars} cars · ${r.race.finalLap}/${r.race.lapsInRace} laps`);
  lines.push(`Ticks     ${r.ticks} polls over ${r.distinctLaps} distinct laps · ${(r.wallMs / 1000).toFixed(1)}s wall`);
  lines.push(`Tick cost p50 ${r.tickMs.p50}ms · p95 ${r.tickMs.p95}ms · max ${r.tickMs.max}ms`);
  lines.push(
    `Payload   p50 ${(r.payloadBytes.p50 / 1024).toFixed(1)} KB · max ${(r.payloadBytes.max / 1024).toFixed(1)} KB`,
  );
  lines.push(
    `Race      ${r.truth.cautionSegments} cautions · ${r.truth.stageEnds} stage ends · ` +
      `${r.truth.leadChanges} lead changes · ${r.truth.retirements} retirements · ${r.truth.pitStops} pit stops`,
  );
  lines.push(`Alerts    ${r.alerts.derived} derived · peak ${r.alerts.maxPerTick} in one tick (lap ${r.alerts.maxPerTickLap})`);
  const kinds = Object.entries(r.alerts.byKind).sort((a, b) => b[1] - a[1]);
  lines.push(`          ${kinds.map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}`);
  lines.push(
    `          race-wide alerts survive min ${r.alerts.globalLifetimeTicks.min} / median ` +
      `${r.alerts.globalLifetimeTicks.median} ticks · ${r.alerts.globalLifetimeTicks.evictedImmediately} gone after one tick`,
  );
  lines.push(
    `Coverage  pass-eff ${pct(r.coverage.passEfficiency)} · adj ${pct(r.coverage.adjPassEfficiency)} · ` +
      `closer ${pct(r.coverage.closerEstimate)} · trends ${pct(r.coverage.trends)} · pit source ${r.coverage.pitCycleSource}`,
  );
  if (!r.violations.length) {
    lines.push(`Invariants ✅ no violations`);
  } else {
    lines.push(`Invariants ❌ ${r.violations.length} violation(s):`);
    for (const v of r.violations) lines.push(`  [tick ${v.tick} lap ${v.lap}] ${v.check}: ${v.detail}`);
  }
  return lines.join("\n");
}

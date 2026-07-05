// Live race companion — pure service. NO bun:sqlite, NO node builtins, NO npm:
// every function here must run unchanged in the Cloudflare Workers runtime (the
// Durable Object calls them). Inputs are the raw live feed + precomputed
// baselines; outputs are normalized snapshots, live metrics, and alert events.

import type {
  FlagState,
  LapLedRange,
  LiveAlertEvent,
  LiveBaselines,
  LiveDriverRow,
  LiveFeed,
  LiveSnapshot,
  LiveVehicle,
  PitCyclePrediction,
} from "./types.ts";
import {
  BIG_MOVER_POSITIONS,
  DEFAULT_STINT_LAPS,
  FLAG_STATES,
  LIVE_FLAG_STATES,
  PS_BUCKET_WIDTH,
  VEHICLE_STATUS_RUNNING,
} from "./config.ts";

// ---- small pure helpers ----

/** Finite number or fallback. */
function num(x: unknown, fallback = 0): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** Numeric flag_state → stable label. */
export function flagOf(flagState: number): FlagState {
  return FLAG_STATES[flagState] ?? "unknown";
}

/** Bucket 0 = P1–P5, 1 = P6–P10, … Mirrors analytics.bucketOf. */
export function bucketOf(position: number, width = PS_BUCKET_WIDTH): number {
  return Math.max(0, Math.floor((position - 1) / width));
}

/** Share of passing encounters won; null when a car had none. Mirrors analytics. */
export function passEfficiency(passesMade: number, timesPassed: number): number | null {
  const encounters = passesMade + timesPassed;
  return encounters === 0 ? null : passesMade / encounters;
}

/** laps_led is an array of {start_lap,end_lap} ranges → total laps led. */
export function sumLapsLed(ranges: LapLedRange[] | undefined | null): number {
  if (!Array.isArray(ranges)) return 0;
  let total = 0;
  for (const r of ranges) {
    const start = num(r?.start_lap);
    const end = num(r?.end_lap);
    if (end >= start && start > 0) total += end - start + 1;
  }
  return total;
}

/** Real pit stops, ignoring the placeholder-zeroed entries seen in some feeds. */
function realPitStops(v: LiveVehicle): number {
  const stops = v.pit_stops;
  if (!Array.isArray(stops)) return 0;
  return stops.filter((p) => num(p?.pit_in_lap_count) > 0).length;
}

function isRunning(v: LiveVehicle): boolean {
  // status is the authoritative code when present; fall back to is_on_track.
  if (typeof v.status === "number") return v.status === VEHICLE_STATUS_RUNNING;
  return v.is_on_track ?? true;
}

// ---- normalize ----

/** Raw feed → normalized snapshot (drivers sorted by running order, metrics null). */
export function normalizeFeed(feed: LiveFeed): LiveSnapshot {
  const flag = flagOf(num(feed.flag_state));
  const vehicles = Array.isArray(feed.vehicles) ? feed.vehicles : [];

  const drivers: LiveDriverRow[] = vehicles
    .map((v): LiveDriverRow => ({
      position: num(v.running_position),
      carNumber: String(v.vehicle_number ?? ""),
      driverId: num(v.driver?.driver_id),
      driverName: v.driver?.full_name ?? "",
      manufacturer: v.vehicle_manufacturer ?? null,
      gapToLeader: num(v.delta),
      lastLapSpeed: v.last_lap_speed == null ? null : num(v.last_lap_speed),
      bestLapSpeed: v.best_lap_speed == null ? null : num(v.best_lap_speed),
      avgRunningPosition: num(v.average_running_position, num(v.running_position)),
      lapsLed: sumLapsLed(v.laps_led),
      lapsCompleted: num(v.laps_completed),
      starting: v.starting_position == null ? null : num(v.starting_position),
      passesMade: num(v.passes_made),
      timesPassed: num(v.times_passed),
      passingDifferential: num(v.passing_differential),
      qualityPasses: num(v.quality_passes),
      positionDiffLast10Pct: num(v.position_differential_last_10_percent),
      fastestLapsRun: num(v.fastest_laps_run),
      pitStopCount: realPitStops(v),
      isOnTrack: v.is_on_track ?? true,
      running: isRunning(v),
      livePassEfficiency: null,
      adjPassEfficiency: null,
      closerEstimate: null,
    }))
    .sort((a, b) => a.position - b.position);

  const stage = feed.stage
    ? {
        num: num(feed.stage.stage_num),
        finishAtLap: num(feed.stage.finish_at_lap),
        lapsInStage: num(feed.stage.laps_in_stage),
      }
    : null;

  return {
    raceId: num(feed.race_id),
    seriesId: num(feed.series_id),
    runName: feed.run_name ?? null,
    trackName: feed.track_name ?? null,
    trackLength: feed.track_length == null ? null : num(feed.track_length),
    lap: num(feed.lap_number),
    lapsInRace: num(feed.laps_in_race),
    lapsToGo: num(feed.laps_to_go),
    elapsedTime: num(feed.elapsed_time),
    flag,
    flagState: num(feed.flag_state),
    stage,
    cautionSegments: num(feed.number_of_caution_segments),
    leadChanges: num(feed.number_of_lead_changes),
    numberOfLeaders: num(feed.number_of_leaders),
    isLive: LIVE_FLAG_STATES.has(flag),
    drivers,
  };
}

// ---- live metrics ----

/** Final 10% of scheduled distance — when position_differential_last_10_percent is meaningful. */
function inClosingLaps(snapshot: LiveSnapshot): boolean {
  return snapshot.lapsInRace > 0 && snapshot.lap >= 0.9 * snapshot.lapsInRace;
}

/**
 * Enrich each driver row with live proprietary-metric estimates:
 *  - livePassEfficiency = passes / (passes + passed)
 *  - adjPassEfficiency  = (live pass eff − league baseline for the car's running
 *                          bucket) × 100  (our Adjusted Pass Efficiency, live)
 *  - closerEstimate     = live last-10% position gain − league closing baseline
 *                          (only during the closing laps; null otherwise)
 * Returns a NEW row array; the input snapshot is not mutated.
 */
export function computeLiveMetrics(
  snapshot: LiveSnapshot,
  baselines: LiveBaselines | null,
): LiveDriverRow[] {
  const closing = inClosingLaps(snapshot);
  return snapshot.drivers.map((d) => {
    const bucket = String(bucketOf(d.avgRunningPosition));
    const livePassEff = passEfficiency(d.passesMade, d.timesPassed);

    const basePass = baselines?.passEffByBucket[bucket];
    const adjPassEfficiency =
      livePassEff != null && basePass != null ? (livePassEff - basePass) * 100 : null;

    const baseCloser = baselines?.closerByBucket[bucket];
    const closerEstimate =
      closing && baseCloser != null ? d.positionDiffLast10Pct - baseCloser : null;

    return { ...d, livePassEfficiency: livePassEff, adjPassEfficiency, closerEstimate };
  });
}

// ---- alerts (diff two consecutive snapshots) ----

export interface DeriveAlertsOptions {
  /** When set, per-driver events fire for these drivers regardless of size. */
  focusDriverIds?: number[];
}

function leaderOf(s: LiveSnapshot): LiveDriverRow | null {
  return s.drivers.find((d) => d.position === 1) ?? s.drivers[0] ?? null;
}

/**
 * Events that happened between `prev` and `next`. Global events (lead change,
 * flag transitions, stage end) always fire. Per-driver events (position moves,
 * pit, out) fire for focus drivers, or — with no focus set — for big movers /
 * all pit-and-out transitions.
 */
export function deriveAlerts(
  prev: LiveSnapshot | null,
  next: LiveSnapshot,
  opts: DeriveAlertsOptions = {},
): LiveAlertEvent[] {
  const events: LiveAlertEvent[] = [];
  const focus = new Set(opts.focusDriverIds ?? []);
  const hasFocus = focus.size > 0;
  const atLap = next.lap;
  if (!prev) return events;

  // Flag transitions.
  if (prev.flag !== next.flag) {
    if (next.flag === "yellow" || next.flag === "red") {
      events.push(mkGlobal("caution", atLap, flagMessage(next.flag)));
    } else if (next.flag === "green") {
      events.push(mkGlobal("green", atLap, "Green flag — back to racing"));
    }
  }

  // Stage end: stage number advanced.
  if (prev.stage && next.stage && next.stage.num > prev.stage.num) {
    events.push(mkGlobal("stage_end", atLap, `Stage ${prev.stage.num} complete`));
  }

  // Lead change.
  const prevLeader = leaderOf(prev);
  const nextLeader = leaderOf(next);
  if (prevLeader && nextLeader && prevLeader.driverId !== nextLeader.driverId) {
    events.push({
      kind: "lead_change",
      atLap,
      message: `${nextLeader.driverName} takes the lead`,
      driverId: nextLeader.driverId,
      carNumber: nextLeader.carNumber,
      fromPosition: nextLeader.position, // now P1
      toPosition: 1,
    });
  }

  // Per-driver diffs.
  const prevById = new Map(prev.drivers.map((d) => [d.driverId, d]));
  for (const d of next.drivers) {
    const before = prevById.get(d.driverId);
    if (!before) continue;
    const focused = focus.has(d.driverId);

    // Position moves (lower number = better position).
    const moved = before.position - d.position; // + = gained
    if (moved !== 0 && (focused || (!hasFocus && Math.abs(moved) >= BIG_MOVER_POSITIONS))) {
      const gained = moved > 0;
      events.push({
        kind: gained ? "position_gain" : "position_loss",
        atLap,
        message: `${d.driverName} ${gained ? "up" : "down"} ${Math.abs(moved)} to P${d.position}`,
        driverId: d.driverId,
        carNumber: d.carNumber,
        fromPosition: before.position,
        toPosition: d.position,
      });
    }

    // Pit stop (real stop count increased).
    if (d.pitStopCount > before.pitStopCount && (focused || !hasFocus)) {
      events.push({
        kind: "pit",
        atLap,
        message: `${d.driverName} pits from P${before.position}`,
        driverId: d.driverId,
        carNumber: d.carNumber,
        fromPosition: before.position,
        toPosition: d.position,
      });
    }

    // Dropped out (was running, now not).
    if (before.running && !d.running && (focused || !hasFocus)) {
      events.push({
        kind: "out",
        atLap,
        message: `${d.driverName} is out`,
        driverId: d.driverId,
        carNumber: d.carNumber,
        fromPosition: before.position,
        toPosition: d.position,
      });
    }
  }

  return events;
}

function mkGlobal(kind: LiveAlertEvent["kind"], atLap: number, message: string): LiveAlertEvent {
  return { kind, atLap, message, driverId: null, carNumber: null, fromPosition: null, toPosition: null };
}

function flagMessage(flag: FlagState): string {
  return flag === "red" ? "Red flag — session stopped" : "Caution is out";
}

// ---- pit-cycle model ----

/**
 * Coarse green-flag pit-window estimate per running car. Inputs from live-feed
 * pit_stops are thin (and placeholder-zeroed in some snapshots), so this infers
 * a stint length from a car's own consecutive stops when it has ≥2, else uses
 * DEFAULT_STINT_LAPS. Phase 2 feeds this from the richer live-pit-data.json.
 */
export function pitCycleModel(
  snapshot: LiveSnapshot,
  feed?: LiveFeed,
): PitCyclePrediction[] {
  // Pull real pit_in laps per car from the raw feed when available.
  const pitLapsByDriver = new Map<number, number[]>();
  if (feed && Array.isArray(feed.vehicles)) {
    for (const v of feed.vehicles) {
      const laps = (v.pit_stops ?? [])
        .map((p) => num(p?.pit_in_lap_count))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      pitLapsByDriver.set(num(v.driver?.driver_id), laps);
    }
  }

  return snapshot.drivers
    .filter((d) => d.running)
    .map((d): PitCyclePrediction => {
      const laps = pitLapsByDriver.get(d.driverId) ?? [];
      const lastGreenPitLap = laps.length ? laps[laps.length - 1]! : null;
      const stintLength = inferStint(laps);
      const lapsSincePit = lastGreenPitLap == null ? null : snapshot.lap - lastGreenPitLap;
      const estimatedNextPitLap = lastGreenPitLap == null ? null : lastGreenPitLap + stintLength;
      return {
        driverId: d.driverId,
        carNumber: d.carNumber,
        pitStopCount: d.pitStopCount,
        lastGreenPitLap,
        lapsSincePit,
        stintLength,
        estimatedNextPitLap,
      };
    });
}

/** Median gap between consecutive pit-in laps, or the default when too few. */
function inferStint(pitLaps: number[]): number {
  if (pitLaps.length < 2) return DEFAULT_STINT_LAPS;
  const gaps: number[] = [];
  for (let i = 1; i < pitLaps.length; i++) gaps.push(pitLaps[i]! - pitLaps[i - 1]!);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return median > 0 ? median : DEFAULT_STINT_LAPS;
}

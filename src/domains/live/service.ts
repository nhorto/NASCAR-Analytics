// Live race companion — pure service. NO bun:sqlite, NO node builtins, NO npm:
// every function here must run unchanged in the Cloudflare Workers runtime (the
// Durable Object calls them). Inputs are the raw live feed + precomputed
// baselines; outputs are normalized snapshots, live metrics, and alert events.

import type {
  FieldLeader,
  FlagState,
  LapLedRange,
  LiveAlertEvent,
  LiveBaselines,
  LiveBattle,
  LiveDriverRow,
  LiveFeed,
  LiveFrame,
  LiveHistory,
  LiveMover,
  LivePitRecord,
  LiveSnapshot,
  LiveVehicle,
  NormalizedPitStop,
  PitCyclePrediction,
  SegTrend,
  Stint,
  TireTier,
  TrackStrategy,
} from "./types.ts";
import {
  BATTLE_GAP_SECONDS,
  BATTLE_TOP_N,
  BIG_MOVER_POSITIONS,
  DEFAULT_STINT_LAPS,
  FLAG_STATES,
  HISTORY_LAPS,
  LIVE_FLAG_STATES,
  MIN_GREEN_STINT_LAPS,
  MOVER_TOP_N,
  MOVER_WINDOW_LAPS,
  PIT_FLAG_GREEN,
  PS_BUCKET_WIDTH,
  SEG_COUNT,
  TIRE_DROP_MIN_SIDE,
  TIRE_TIER_HIGH,
  TIRE_TIER_MODERATE,
  TREND_SAMPLES,
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

export interface PitCycleOptions {
  /**
   * Authoritative pit stops (from live-pit-data.json, keyed to cars by number).
   * When present these supersede the coarse live-feed `pit_stops` — they carry
   * real lap numbers AND flag status, so we can use only GREEN stops (a caution
   * stop doesn't set a green-run cadence). Preferred source.
   */
  pitStops?: NormalizedPitStop[];
  /** Raw live-feed fallback when the pit feed is unavailable (placeholder-zeroed). */
  feed?: LiveFeed;
  /** Per-track calibration (typical green run). Null ⇒ fall back to DEFAULT_STINT_LAPS. */
  trackStrategy?: TrackStrategy | null;
}

/**
 * Green-flag pit-cycle estimate per running car. Prefers the real pit feed
 * (green stops only) and the per-track calibrated typical-run length; falls back
 * to the coarse live-feed pit_stops + DEFAULT_STINT_LAPS when neither is
 * available. `stintLength` is a behavioral cadence (from calibration or the car's
 * own observed gaps), NOT a fuel gauge — `lapsToTypicalPit` is an estimate.
 */
export function pitCycleModel(
  snapshot: LiveSnapshot,
  opts: PitCycleOptions = {},
): PitCyclePrediction[] {
  const usingPitData = Array.isArray(opts.pitStops) && opts.pitStops.length > 0;

  // Green pit-in laps per car. From the pit feed we keep only green stops; from
  // the live-feed fallback we can't tell flag, so we keep all (best effort).
  const greenPitLapsByCar = new Map<string, number[]>();
  if (usingPitData) {
    for (const p of opts.pitStops!) {
      if (p.lap <= 0 || p.flagStatus !== PIT_FLAG_GREEN) continue;
      const arr = greenPitLapsByCar.get(p.carNumber) ?? [];
      arr.push(p.lap);
      greenPitLapsByCar.set(p.carNumber, arr);
    }
  } else if (opts.feed && Array.isArray(opts.feed.vehicles)) {
    for (const v of opts.feed.vehicles) {
      const laps = (v.pit_stops ?? [])
        .map((p) => num(p?.pit_in_lap_count))
        .filter((n) => n > 0);
      greenPitLapsByCar.set(String(v.vehicle_number ?? ""), laps);
    }
  }
  for (const laps of greenPitLapsByCar.values()) laps.sort((a, b) => a - b);

  // Typical green-flag run: calibrated per-track median, else the flat default.
  const typicalStint =
    opts.trackStrategy?.typicalStintLaps != null && opts.trackStrategy.typicalStintLaps > 0
      ? opts.trackStrategy.typicalStintLaps
      : DEFAULT_STINT_LAPS;
  const source: PitCyclePrediction["source"] = usingPitData ? "pit-data" : "feed";

  return snapshot.drivers
    .filter((d) => d.running)
    .map((d): PitCyclePrediction => {
      const laps = greenPitLapsByCar.get(d.carNumber) ?? [];
      const lastGreenPitLap = laps.length ? laps[laps.length - 1]! : null;
      // Prefer the car's own observed cadence; else the calibrated typical run.
      const stintLength = inferStint(laps, typicalStint);
      const lapsSincePit = lastGreenPitLap == null ? null : snapshot.lap - lastGreenPitLap;
      const estimatedNextPitLap = lastGreenPitLap == null ? null : lastGreenPitLap + stintLength;
      const lapsToTypicalPit =
        lastGreenPitLap == null ? null : Math.max(0, stintLength - (snapshot.lap - lastGreenPitLap));
      return {
        driverId: d.driverId,
        carNumber: d.carNumber,
        pitStopCount: d.pitStopCount,
        lastGreenPitLap,
        lapsSincePit,
        stintLength,
        estimatedNextPitLap,
        lapsToTypicalPit,
        source,
      };
    });
}

/** Median gap between consecutive pit-in laps, or the fallback when too few. */
function inferStint(pitLaps: number[], fallback: number): number {
  if (pitLaps.length < 2) return fallback;
  const gaps: number[] = [];
  for (let i = 1; i < pitLaps.length; i++) gaps.push(pitLaps[i]! - pitLaps[i - 1]!);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return median > 0 ? median : fallback;
}

// ---- strategy calibration (pure; shared by the live model + the offline batch) ----
// No feed carries tire wear or fuel level (see docs/research/2026-07-06_*), so
// these derive a typical green-run length + a tire-severity index from timing
// data. Tire severity uses the pit-DISCONTINUITY (fresh-vs-worn) method — a
// within-stint OLS slope is fuel-burn-confounded and was removed after the
// 2026-07-05 validation. They run in the Workers runtime (live) AND in the Bun
// calibration script (backfill). See
// docs/exec-plans/active/2026-07-06-strategy-model-calibration.md.

/** live-pit-data.json rows → normalized pit stops (join key = car number). */
export function pitStopsFromLivePitData(records: LivePitRecord[]): NormalizedPitStop[] {
  if (!Array.isArray(records)) return [];
  const out: NormalizedPitStop[] = [];
  for (const r of records) {
    const lap = num(r?.lap_count);
    if (lap <= 0) continue; // drop lap-0 pre-race placeholder rows
    const tiresChanged =
      (r.left_front_tire_changed ? 1 : 0) +
      (r.left_rear_tire_changed ? 1 : 0) +
      (r.right_front_tire_changed ? 1 : 0) +
      (r.right_rear_tire_changed ? 1 : 0);
    out.push({
      carNumber: String(r.vehicle_number ?? ""),
      driverId: null,
      lap,
      flagStatus: num(r.pit_in_flag_status),
      tiresChanged,
    });
  }
  return out;
}

/**
 * Reconstruct each car's stints from its pit stops. A stint runs from the race
 * start (or a pit-out) to the next pit-in (or the finish). A stint is a "clean
 * green run" only when the car both started the stint green and pitted under
 * green — the samples a fuel window can be calibrated from.
 */
export function reconstructStints(pits: NormalizedPitStop[], lapsInRace: number): Stint[] {
  const byCar = new Map<string, NormalizedPitStop[]>();
  for (const p of pits) {
    if (p.lap <= 0) continue;
    const arr = byCar.get(p.carNumber) ?? [];
    arr.push(p);
    byCar.set(p.carNumber, arr);
  }
  const stints: Stint[] = [];
  for (const [carNumber, stopsRaw] of byCar) {
    const stops = stopsRaw.slice().sort((a, b) => a.lap - b.lap);
    let prevOutLap = 0; // race start
    let prevStartedGreen = true; // green start
    for (const s of stops) {
      const greenRun = prevStartedGreen && s.flagStatus === PIT_FLAG_GREEN;
      stints.push({
        carNumber,
        startLap: prevOutLap,
        endLap: s.lap,
        laps: s.lap - prevOutLap,
        endedFlag: s.flagStatus,
        greenRun,
      });
      prevOutLap = s.lap;
      prevStartedGreen = s.flagStatus === PIT_FLAG_GREEN; // out flag ≈ in flag
    }
    if (lapsInRace > prevOutLap) {
      stints.push({
        carNumber,
        startLap: prevOutLap,
        endLap: lapsInRace,
        laps: lapsInRace - prevOutLap,
        endedFlag: -1, // reached the finish
        greenRun: false, // truncated by the checkered, not a fuel stop
      });
    }
  }
  return stints;
}

/** Clean green-flag stint lengths above the noise floor — typical-run samples. */
export function greenStintLengths(stints: Stint[]): number[] {
  return stints
    .filter((s) => s.greenRun && s.laps >= MIN_GREEN_STINT_LAPS)
    .map((s) => s.laps);
}

/** Lap-time lookups injected into the pure tire-drop kernel (DB-backed offline). */
export interface TireDropContext {
  /** Lap time for a given lap, or null if unknown / missing. */
  lapTimeAt(lap: number): number | null;
  /** Whether a lap ran green (not under caution). Non-green laps are skipped. */
  isGreenLap(lap: number): boolean;
}

/**
 * Worn−fresh lap-time gap (sec) across ONE green 4-tire pit stop: mean of the
 * last clean green laps before pitting minus the mean of the first clean green
 * laps after (skipping the out-lap). Positive ⇒ worn tires were slower than
 * fresh — the real tire-degradation signal. Unlike a within-stint OLS slope this
 * is NOT confounded by fuel burn to first order (both windows sit near a common
 * fuel state at the stop), and it orders tracks by tire severity correctly. The
 * remaining ~constant fuel penalty (heavier after refuel) is roughly equal
 * across tracks, so it does not corrupt the between-track ranking. Returns null
 * when either side lacks enough clean green laps.
 */
export function tireDropForStop(pitLap: number, ctx: TireDropContext): number | null {
  const collect = (from: number, step: number, limit: number): number[] => {
    const out: number[] = [];
    for (let l = from; out.length < 3 && Math.abs(l - from) < limit; l += step) {
      if (l <= 0 || !ctx.isGreenLap(l)) continue;
      const t = ctx.lapTimeAt(l);
      if (t != null && Number.isFinite(t) && t > 0) out.push(t);
    }
    return out;
  };
  // pre: the 3 green laps immediately before pit-in (walk backward).
  const pre = collect(pitLap - 1, -1, 8);
  // post: green laps starting 3 laps after the stop (skip out-lap + settle).
  const post = collect(pitLap + 3, 1, 8);
  if (pre.length < TIRE_DROP_MIN_SIDE || post.length < TIRE_DROP_MIN_SIDE) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const drop = mean(pre) - mean(post);
  return Number.isFinite(drop) ? drop : null;
}

/** Coarse tire-severity tier from the median worn−fresh gap (sec). Null ⇒ unknown. */
export function tireTierOf(tireSeconds: number | null): TireTier | null {
  if (tireSeconds == null || !Number.isFinite(tireSeconds)) return null;
  if (tireSeconds >= TIRE_TIER_HIGH) return "high";
  if (tireSeconds >= TIRE_TIER_MODERATE) return "moderate";
  return "low";
}

/** Median of a numeric sample (empty ⇒ null). */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---- rolling history + trend derivation (Phase 3) ----
// The single live snapshot can't show change-over-time (segbars, movers, tire
// falloff). The edge keeps a capped per-lap history; these pure functions append
// to it and derive the time-series the UI needs.

/**
 * Append the current snapshot as a new per-lap frame, but only when the lap
 * actually advanced (avoids dupes when we poll faster than the CDN's lap tick)
 * and a session is running (skips pre-race lap 0). Caps the buffer to HISTORY_LAPS.
 * Pass `prev = null` to start fresh (e.g. a new race).
 */
export function updateHistory(prev: LiveHistory | null, snapshot: LiveSnapshot): LiveHistory {
  const frames: LiveFrame[] = prev?.frames ? prev.frames.slice() : [];
  const last = frames[frames.length - 1];
  const lap = snapshot.lap;
  if (lap > 0 && (!last || lap > last.lap)) {
    const pos: Record<string, number> = {};
    const spd: Record<string, number | null> = {};
    for (const d of snapshot.drivers) {
      pos[String(d.driverId)] = d.position;
      spd[String(d.driverId)] = d.lastLapSpeed;
    }
    frames.push({ lap, pos, spd });
    while (frames.length > HISTORY_LAPS) frames.shift();
  }
  return { frames };
}

/** This driver's (lap, position) samples across the history, oldest→newest. */
function posSamplesOf(driverId: number, history: LiveHistory): Array<{ lap: number; pos: number }> {
  const key = String(driverId);
  const out: Array<{ lap: number; pos: number }> = [];
  for (const f of history.frames) {
    const p = f.pos[key];
    if (p != null) out.push({ lap: f.lap, pos: p });
  }
  return out;
}

/**
 * Enrich each driver with history-derived trends: a last-SEG_COUNT-lap segbar
 * (gaining/holding/losing), position + speed sparkline series, and the net
 * positions moved over the last ~MOVER_WINDOW_LAPS laps. Returns NEW rows.
 * Expects `history` to already include the current snapshot's frame.
 */
export function attachTrends(drivers: LiveDriverRow[], history: LiveHistory): LiveDriverRow[] {
  return drivers.map((d) => {
    const key = String(d.driverId);
    const samples = posSamplesOf(d.driverId, history);

    const posTrend = samples.slice(-TREND_SAMPLES).map((s) => s.pos);
    const spdTrend: Array<number | null> = [];
    for (const f of history.frames.slice(-TREND_SAMPLES)) {
      if (f.pos[key] != null) spdTrend.push(f.spd[key] ?? null);
    }

    const segments: SegTrend[] = [];
    const tail = samples.slice(-(SEG_COUNT + 1));
    for (let i = 1; i < tail.length; i++) {
      const delta = tail[i - 1]!.pos - tail[i]!.pos; // + = gained a spot
      segments.push(delta > 0 ? "g" : delta < 0 ? "r" : "y");
    }

    let mover10: number | null = null;
    if (samples.length) {
      const cur = samples[samples.length - 1]!;
      let past: number | null = null;
      for (let i = samples.length - 1; i >= 0; i--) {
        if (samples[i]!.lap <= cur.lap - MOVER_WINDOW_LAPS) {
          past = samples[i]!.pos;
          break;
        }
      }
      if (past != null) mover10 = past - cur.pos; // + = gained
    }

    return { ...d, segments, posTrend, spdTrend, mover10 };
  });
}

function toMover(d: LiveDriverRow, delta: number): LiveMover {
  return {
    driverId: d.driverId,
    driverName: d.driverName,
    carNumber: d.carNumber,
    manufacturer: d.manufacturer,
    delta,
  };
}

/** Biggest gainers / faders over the mover window (needs attachTrends first). */
export function deriveMovers(drivers: LiveDriverRow[]): { gaining: LiveMover[]; fading: LiveMover[] } {
  const moved = drivers.filter((d) => d.mover10 != null && d.mover10 !== 0);
  const gaining = moved
    .filter((d) => (d.mover10 as number) > 0)
    .sort((a, b) => (b.mover10 as number) - (a.mover10 as number))
    .slice(0, MOVER_TOP_N)
    .map((d) => toMover(d, d.mover10 as number));
  const fading = moved
    .filter((d) => (d.mover10 as number) < 0)
    .sort((a, b) => (a.mover10 as number) - (b.mover10 as number))
    .slice(0, MOVER_TOP_N)
    .map((d) => toMover(d, d.mover10 as number));
  return { gaining, fading };
}

/**
 * Cars racing nose-to-tail: adjacent in running order and within BATTLE_GAP_SECONDS
 * on track. `closing` is set when the pair's gap shrank vs the previous snapshot.
 */
export function deriveBattles(
  drivers: LiveDriverRow[],
  prevDrivers: LiveDriverRow[] | null,
): LiveBattle[] {
  const sorted = drivers.slice().sort((a, b) => a.position - b.position);
  const prevGap = new Map<number, number>();
  if (prevDrivers) for (const d of prevDrivers) prevGap.set(d.driverId, d.gapToLeader);

  const battles: LiveBattle[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const lead = sorted[i - 1]!;
    const trail = sorted[i]!;
    if (!lead.running || !trail.running) continue;
    const gap = trail.gapToLeader - lead.gapToLeader;
    if (gap <= 0 || gap > BATTLE_GAP_SECONDS) continue;

    let closing = false;
    const pl = prevGap.get(lead.driverId);
    const pt = prevGap.get(trail.driverId);
    if (pl != null && pt != null) closing = gap < pt - pl;

    battles.push({
      aId: lead.driverId, aName: lead.driverName, aCar: lead.carNumber, aPos: lead.position,
      bId: trail.driverId, bName: trail.driverName, bCar: trail.carNumber, bPos: trail.position,
      gap, closing,
    });
  }
  return battles.sort((a, b) => a.gap - b.gap).slice(0, BATTLE_TOP_N);
}

/** The live field leader of each loop/proprietary metric (running cars only). */
export function deriveFieldLeaders(drivers: LiveDriverRow[]): FieldLeader[] {
  const running = drivers.filter((d) => d.running);
  const specs: Array<{ key: string; label: string; get: (d: LiveDriverRow) => number | null }> = [
    { key: "adjPE", label: "Adj Pass Eff", get: (d) => d.adjPassEfficiency },
    { key: "qualityPasses", label: "Quality Pass", get: (d) => d.qualityPasses },
    { key: "closer", label: "Closer est.", get: (d) => d.closerEstimate },
    { key: "fastLaps", label: "Fast Laps", get: (d) => d.fastestLapsRun },
  ];
  const out: FieldLeader[] = [];
  for (const s of specs) {
    let best: LiveDriverRow | null = null;
    let bestV = -Infinity;
    for (const d of running) {
      const v = s.get(d);
      if (v != null && v > bestV) {
        bestV = v;
        best = d;
      }
    }
    if (best && Number.isFinite(bestV)) {
      out.push({ key: s.key, label: s.label, driverId: best.driverId, driverName: best.driverName, carNumber: best.carNumber, value: bestV });
    }
  }
  return out;
}

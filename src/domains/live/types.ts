// Live race companion — domain types.
//
// Two families:
//   1. Raw shapes of the NASCAR public CDN live feed (cf.nascar.com/live/feeds).
//      Typed from a captured fixture (tests/fixtures/live-feed.json). The feed is
//      untrusted JSON, so the normalizer coerces defensively; optional fields here
//      mean "may be absent/null in some snapshots", not "we don't read them".
//   2. Normalized shapes our app renders (LiveSnapshot / LiveDriverRow / alerts).
//
// This whole domain must run in BOTH Bun and the Cloudflare Workers runtime, so
// types carry zero runtime imports and nothing external (enforced by architecture
// tests). See docs/exec-plans/active/2026-07-05-live-race-companion.md.

// ---- Raw CDN feed ----

/** A contiguous run of laps a car led; laps_led is an array of these. */
export interface LapLedRange {
  start_lap: number;
  end_lap: number;
}

export interface LiveDriverInfo {
  driver_id: number;
  full_name: string;
  first_name?: string;
  last_name?: string;
  is_in_chase?: boolean;
}

/**
 * Per-car pit entry as it appears INSIDE live-feed.json. Note: in captured
 * end-of-race snapshots these are often placeholder-zeroed — authoritative pit
 * timing is the separate live-pit-data.json feed (Phase 2). We still parse the
 * count/lap here for a coarse "has pitted N times" read.
 */
export interface LivePitStop {
  pit_in_lap_count?: number;
  pit_out_elapsed_time?: number;
  pit_in_elapsed_time?: number;
  pit_in_leader_lap?: number;
  pit_in_rank?: number;
  pit_out_rank?: number;
  positions_gained_lossed?: number;
}

/** One car in the live feed. Only fields the normalizer reads are listed. */
export interface LiveVehicle {
  running_position: number;
  vehicle_number: string;
  driver: LiveDriverInfo;
  delta: number; // gap to leader (seconds); 0 for the leader
  last_lap_time?: number;
  last_lap_speed?: number;
  best_lap_time?: number;
  best_lap_speed?: number;
  average_speed?: number;
  average_running_position: number;
  laps_completed?: number;
  laps_led?: LapLedRange[];
  passes_made?: number;
  times_passed?: number;
  passing_differential?: number;
  quality_passes?: number;
  position_differential_last_10_percent?: number;
  fastest_laps_run?: number;
  laps_position_improved?: number;
  pit_stops?: LivePitStop[];
  is_on_track?: boolean;
  is_on_dvp?: boolean; // damaged-vehicle policy clock running
  status?: number; // running-status code (see config.VEHICLE_STATUS_RUNNING)
  starting_position?: number;
  sponsor_name?: string;
  vehicle_manufacturer?: string;
}

export interface LiveStageInfo {
  stage_num: number;
  finish_at_lap: number;
  laps_in_stage: number;
}

/** Top-level live-feed.json payload. */
export interface LiveFeed {
  race_id: number;
  series_id: number;
  run_id?: number;
  run_name?: string;
  run_type?: number;
  track_id?: number;
  track_name?: string;
  track_length?: number;
  lap_number: number;
  laps_in_race: number;
  laps_to_go: number;
  elapsed_time: number;
  flag_state: number;
  number_of_caution_segments?: number;
  number_of_caution_laps?: number;
  number_of_lead_changes?: number;
  number_of_leaders?: number;
  avg_diff_1to3?: number;
  stage?: LiveStageInfo | null;
  vehicles: LiveVehicle[];
}

// ---- Normalized (what the app renders) ----

/** Human/stable flag label, decoded from the numeric flag_state. */
export type FlagState =
  | "none"
  | "green"
  | "yellow"
  | "red"
  | "white"
  | "checkered"
  | "hot"
  | "cold"
  | "unknown";

/** One car, normalized. Metric fields are null until computeLiveMetrics runs. */
export interface LiveDriverRow {
  position: number;
  carNumber: string;
  driverId: number;
  driverName: string;
  manufacturer: string | null;
  gapToLeader: number; // seconds; 0 for leader
  lastLapSpeed: number | null;
  bestLapSpeed: number | null;
  avgRunningPosition: number;
  lapsLed: number; // summed from laps_led ranges
  lapsCompleted: number;
  starting: number | null;
  passesMade: number;
  timesPassed: number;
  passingDifferential: number;
  qualityPasses: number;
  positionDiffLast10Pct: number;
  fastestLapsRun: number;
  pitStopCount: number;
  isOnTrack: boolean;
  running: boolean; // status maps to actively-running
  // Filled by computeLiveMetrics (null when inputs are insufficient):
  livePassEfficiency: number | null; // passes / (passes + passed), 0–1
  adjPassEfficiency: number | null; // residual vs league baseline, ×100
  closerEstimate: number | null; // live last-10% position diff vs baseline
  // Filled by the history enrichment (attachTrends) — undefined in the raw snapshot,
  // populated only at the edge where per-lap history exists:
  segments?: SegTrend[]; // last-5-lap trend, oldest→newest (segbar)
  posTrend?: number[]; // recent running positions, oldest→newest (sparkline)
  spdTrend?: Array<number | null>; // recent last-lap speeds, oldest→newest (falloff)
  mover10?: number | null; // positions gained (+) / lost (−) vs ~10 laps ago
}

/** One segbar tick: gaining (green) / holding (yellow) / losing (red). */
export type SegTrend = "g" | "y" | "r";

export interface LiveSnapshot {
  raceId: number;
  seriesId: number;
  runName: string | null;
  trackName: string | null;
  trackLength: number | null;
  lap: number;
  lapsInRace: number;
  lapsToGo: number;
  elapsedTime: number;
  flag: FlagState;
  flagState: number;
  stage: { num: number; finishAtLap: number; lapsInStage: number } | null;
  cautionSegments: number;
  leadChanges: number;
  numberOfLeaders: number;
  /** True when a session is actually on track (not idle/finished). */
  isLive: boolean;
  drivers: LiveDriverRow[];
}

export type LiveAlertKind =
  | "lead_change"
  | "position_gain"
  | "position_loss"
  | "pit"
  | "caution"
  | "green"
  | "stage_end"
  | "out";

/** A single event derived by diffing two consecutive snapshots. */
export interface LiveAlertEvent {
  kind: LiveAlertKind;
  atLap: number;
  message: string;
  driverId: number | null;
  carNumber: string | null;
  fromPosition: number | null;
  toPosition: number | null;
}

/** Coarse green-flag pit-window estimate for one car. */
export interface PitCyclePrediction {
  driverId: number;
  carNumber: string;
  pitStopCount: number;
  lastGreenPitLap: number | null;
  lapsSincePit: number | null;
  stintLength: number; // assumed green-flag stint (laps) used for the estimate
  estimatedNextPitLap: number | null;
}

/**
 * Per-series league baselines the live metrics compare against, emitted by the
 * weekly batch as dist/data/baselines.json. JSON-friendly (Record, not Map);
 * keys are bucket indices as strings (bucket 0 = P1–P5, …).
 */
export interface LiveBaselines {
  seriesId: number;
  bucketWidth: number;
  /** Mean green-flag pass efficiency by avg running-position bucket. */
  passEffByBucket: Record<string, number>;
  /** Mean closing-laps position gain by closing-position bucket. */
  closerByBucket: Record<string, number>;
}

/**
 * One captured lap of history: each running car's position + last-lap speed at
 * `lap`. Keyed by driverId (string for JSON). Kept in a capped rolling buffer so
 * the edge can derive trends the single snapshot can't (segbars, movers, falloff).
 */
export interface LiveFrame {
  lap: number;
  pos: Record<string, number>;
  spd: Record<string, number | null>;
}

/** Rolling per-lap history the DO persists between ticks. */
export interface LiveHistory {
  frames: LiveFrame[];
}

/** A car among the biggest position gainers/faders over the mover window. */
export interface LiveMover {
  driverId: number;
  driverName: string;
  carNumber: string;
  manufacturer: string | null;
  delta: number; // + gained / − lost over the window
}

/** Two cars racing nose-to-tail (within the battle-gap threshold on track). */
export interface LiveBattle {
  aId: number;
  aName: string;
  aCar: string;
  aPos: number;
  bId: number;
  bName: string;
  bCar: string;
  bPos: number;
  gap: number; // seconds between them
  closing: boolean; // gap shrinking vs the previous frame
}

/** The live leader of one proprietary/loop metric across the field. */
export interface FieldLeader {
  key: string; // "adjPE" | "qualityPasses" | "closer" | "fastLaps"
  label: string;
  driverId: number;
  driverName: string;
  carNumber: string;
  value: number;
}

/** The next scheduled session for the idle "Next Up" card. */
export interface NextRace {
  seriesId: number;
  name: string | null;
  trackName: string | null;
  startTimeUtc: string | null;
}

/**
 * The client-facing payload the edge stores and serves at GET /api/live: the
 * enriched snapshot (leaderboard + live metrics + trends), the rolling alert feed
 * (newest first), pit-cycle predictions, race-overview derivations, and
 * liveness/timing. JSON-serializable.
 */
export interface LivePayload {
  ok: boolean;
  /** True when a session is actually on track (mirrors snapshot.isLive). */
  live: boolean;
  /** Wall-clock ms the snapshot was fetched from upstream. */
  fetchedAt: number;
  snapshot: LiveSnapshot;
  alerts: LiveAlertEvent[];
  pitCycles: PitCyclePrediction[];
  movers: { gaining: LiveMover[]; fading: LiveMover[] };
  battles: LiveBattle[];
  fieldLeaders: FieldLeader[];
  nextRace: NextRace | null;
}

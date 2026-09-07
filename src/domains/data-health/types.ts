// Data-health domain — types for the upstream-feed canary.
//
// The canary asks one question per upstream endpoint: "does it still answer
// with the shape our normalizers expect?" A check pairs a URL with a pure
// shape validator; a result records what came back. Nothing here knows how
// to fetch — the runner receives a fetcher so it is testable and portable.

/** A shape validator: returns null when the payload is acceptable, else a short problem string. */
export type ShapeValidator = (json: unknown) => string | null;

export interface HealthCheck {
  /** Stable id used in reports and, later, the feed_status table (e.g. "loopstats"). */
  id: string;
  url: string;
  validate: ShapeValidator;
  /** Human label for the report line. */
  label: string;
}

export interface FetchedJson {
  status: number;
  json: unknown;
}

export interface CheckResult {
  id: string;
  label: string;
  url: string;
  status: number;
  ok: boolean;
  /** Why it failed: an HTTP status problem, a shape problem, or a transport error. */
  problem: string | null;
  ms: number;
}

export interface CanaryReport {
  /** ISO timestamp of the run. */
  at: string;
  results: CheckResult[];
  failures: number;
  /** True when every check passed. */
  healthy: boolean;
}

/** One persisted canary run for one check (the feed_status table). */
export interface FeedStatusRow {
  checkId: string;
  runAt: string;
  ok: boolean;
  httpStatus: number;
  problem: string | null;
  ms: number;
}

/** A check whose latest consecutive runs all failed (>= the alert threshold). */
export interface FeedOutage {
  checkId: string;
  consecutiveFailures: number;
  /** run_at of the first failing run in the streak. */
  since: string;
  problem: string | null;
}

// ---------------------------------------------------------------------------
// Fallback source: the nascaR.data Parquet release (results-only, 1949+,
// sourced from DriverAverages.com with permission). It has no CDN race or
// driver ids — the adapter joins on (season, points-race ordinal) and driver
// name, both provided by the caller so this domain stays I/O-free.
// ---------------------------------------------------------------------------

/** One row of the nascaR.data release, coerced to plain JS values. */
export interface NascarDataRow {
  season: number;
  /** Points-race ordinal within the season (1-based, completed races). */
  race: number;
  track: string;
  raceName: string;
  finish: number;
  start: number | null;
  car: string | null;
  driver: string;
  team: string | null;
  make: string | null;
  points: number | null;
  laps: number | null;
  led: number | null;
  status: string | null;
}

/** A points race of ours, in season order, for joining release rows by ordinal. */
export interface FallbackRaceRef {
  raceId: number;
  season: number;
  /** 1-based position among the season's completed points races, by date. */
  ordinal: number;
  trackName: string;
}

export interface FallbackDriverRef {
  driverId: number;
  fullName: string;
}

/** A result reconstructed from the fallback source. Fields the release lacks
 * (team/qualifying ids, playoff points, …) stay null — honest, not guessed. */
export interface FallbackResultRow {
  raceId: number;
  driverId: number;
  finishingPosition: number;
  startingPosition: number | null;
  carNumber: string | null;
  teamName: string | null;
  lapsLed: number | null;
  carMake: string | null;
  pointsEarned: number | null;
  lapsCompleted: number | null;
  finishingStatus: string | null;
}

export interface FallbackMapping {
  /** Mapped rows grouped per race, only for races that passed the track sanity check. */
  races: Array<{ raceId: number; ordinal: number; rows: FallbackResultRow[] }>;
  /** Release driver names with no match in our drivers index (their rows are dropped). */
  unmatchedDrivers: string[];
  /** Ordinals we refused to map, with the reason (e.g. track-name mismatch). */
  skippedRaces: Array<{ ordinal: number; reason: string }>;
}

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

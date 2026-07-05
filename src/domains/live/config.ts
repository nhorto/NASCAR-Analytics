import type { FlagState } from "./types.ts";

// Live race companion — domain config. Pure constants only (no external imports).

/** Numeric flag_state → stable label. Source: rNascar23.Sdk / captured feeds. */
export const FLAG_STATES: Record<number, FlagState> = {
  0: "none",
  1: "green",
  2: "yellow",
  3: "red",
  4: "white",
  5: "checkered",
  8: "hot",
  9: "cold",
};

/** Flags that mean a session is actively on track (racing/paused mid-run). */
export const LIVE_FLAG_STATES: ReadonlySet<FlagState> = new Set<FlagState>([
  "green",
  "yellow",
  "red",
  "white",
]);

/** Poll cadence for the upstream feed while a session is live. */
export const POLL_INTERVAL_MS = 5_000;

/** Backoff cadence when no session is on track (keeps idle cost ~$0). */
export const IDLE_POLL_INTERVAL_MS = 60_000;

/** Edge cache TTL (s) for the fanned-out /api/live response. */
export const EDGE_CACHE_SECONDS = 3;

/** A car gaining/losing at least this many positions between snapshots alerts. */
export const BIG_MOVER_POSITIONS = 3;

/**
 * Running-position bucket width for baseline lookup. MUST match analytics
 * PS_BUCKET_WIDTH — the live metric residuals compare against baselines the
 * analytics batch computes with the same bucketing. (Cross-domain constants are
 * not shared at runtime to keep this domain Workers-portable and dependency-free.)
 */
export const PS_BUCKET_WIDTH = 5;

/** vehicles[].status code for a car that is actively running (not out/retired). */
export const VEHICLE_STATUS_RUNNING = 1;

/**
 * Fallback green-flag stint length (laps) for the pit-cycle estimate when a
 * car's own pit history is too thin to infer one. Coarse on purpose — refined
 * per-track with live/historical data in a later phase.
 */
export const DEFAULT_STINT_LAPS = 40;

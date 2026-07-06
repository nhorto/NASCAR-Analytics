import type { FlagState } from "./types.ts";

// Live race companion — domain config. Pure constants only (no external imports).

/**
 * MANDATORY browser User-Agent for every NASCAR CDN request. The CDN 403s
 * requests without one. Shared by the capture CLI (Bun) and the edge Worker
 * (Cloudflare) so there is a single source of truth for what we send upstream.
 */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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
 * car's own pit history is too thin to infer one AND no per-track calibration
 * (track-strategy.json) is available. Coarse on purpose — the calibrated
 * `greenStintLaps` per track supersedes it once the backfill has been run.
 */
export const DEFAULT_STINT_LAPS = 40;

// ---- strategy calibration (tire/fuel/pit) ----

/** Numeric flag_state meaning a green (racing) pit stop. Matches FLAG_STATES. */
export const PIT_FLAG_GREEN = 1;

/**
 * Ignore green "stints" shorter than this when calibrating a fuel window — a
 * handful of laps is a splash-and-go or a damage stop, not a fuel run.
 */
export const MIN_GREEN_STINT_LAPS = 10;

/**
 * Minimum clean green-flag samples before we trust a per-track fuel window;
 * below this the live model falls back to the track-type aggregate, then the
 * flat DEFAULT_STINT_LAPS. (The 2026-07-06 spike showed one race yields ~3 —
 * so a credible per-track number needs many races.)
 */
export const MIN_GREEN_STINT_SAMPLES = 8;

/**
 * Minimum (lap, lapTime) points in a green run before we fit a falloff slope.
 * Short runs are dominated by out-lap noise and fuel-burn, not tire wear.
 */
export const MIN_FALLOFF_SAMPLES = 8;

// ---- history / trend derivation (Phase 3) ----

/** Max per-lap frames the edge keeps in the rolling history buffer. */
export const HISTORY_LAPS = 30;

/** Number of segbar ticks (the last-N-lap trend shown under each driver). */
export const SEG_COUNT = 5;

/** Window (laps) for the Race Overview "movers" gainers/faders. */
export const MOVER_WINDOW_LAPS = 10;

/** How many movers to surface on each side (gaining / fading). */
export const MOVER_TOP_N = 3;

/** Two cars within this on-track gap (seconds) count as a live "battle". */
export const BATTLE_GAP_SECONDS = 0.4;

/** Max battles surfaced in Race Overview. */
export const BATTLE_TOP_N = 5;

/** Length of the per-driver trend series (position / speed sparklines). */
export const TREND_SAMPLES = 12;

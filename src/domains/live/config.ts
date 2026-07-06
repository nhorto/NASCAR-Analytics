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
 * `typicalStintLaps` per track supersedes it once the backfill has been run.
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
 * Minimum clean green-flag samples before we trust a per-track typical-run
 * window; below this the live model falls back to the track-type aggregate,
 * then the flat DEFAULT_STINT_LAPS. (The spike showed one race yields ~3 clean
 * green stints — so a credible per-track number needs many races.)
 */
export const MIN_GREEN_STINT_SAMPLES = 8;

/**
 * Minimum green 4-tire stops behind a per-track tire-severity number. Below this
 * the tire tier falls back to the track-type aggregate. Tire severity comes from
 * the pit-discontinuity (worn−fresh) method — the within-stint OLS slope is
 * fuel-burn-confounded and was removed (see the 2026-07-05 validation).
 */
export const MIN_TIRE_SAMPLES = 20;

/**
 * Clean green laps needed on EACH side of a green 4-tire stop to measure its
 * worn−fresh lap-time drop (out-lap is skipped, so "after" starts a few laps in).
 */
export const TIRE_DROP_MIN_SIDE = 2;

/**
 * tireSeconds (median worn−fresh gap, sec) tier thresholds. Calibrated from the
 * backfill: Darlington ≈1.9, Richmond ≈1.35, road ≈0.8, intermediate ≈0.7,
 * Talladega ≈0.19. High ⇒ tire management dominates; low ⇒ draft/fuel tracks
 * where a tire narrative is noise.
 */
export const TIRE_TIER_HIGH = 1.0;
export const TIRE_TIER_MODERATE = 0.45;

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

// Data-health domain — thresholds for the upstream-feed canary.

/** Per-request timeout. The CDN normally answers in well under a second. */
export const CANARY_TIMEOUT_MS = 15_000;

/**
 * How many consecutive daily failures of one check count as an outage worth
 * paging the owner (WS-C wires this to the feed_status table; the v0 CI canary
 * simply fails the workflow run, which GitHub emails about).
 */
export const CONSECUTIVE_FAILURES_TO_ALERT = 2;

/** A race is considered final this long after its scheduled start (mirrors ingestion). */
export const RACE_FINALITY_BUFFER_MS = 6 * 60 * 60 * 1000;

/**
 * nascaR.data (DriverAverages) naming → the NASCAR CDN naming our tables use.
 * Verified against the real 2026 release on 2026-09-07. Comparison is
 * canonicalized (case/punctuation-insensitive), so entries here are cosmetic
 * spellings, not keys.
 */
export const FALLBACK_TRACK_ALIASES: Record<string, string> = {
  // Atlanta sold naming rights in 2025; the CDN schedule kept the old name.
  "EchoPark Speedway": "Atlanta Motor Speedway",
  // The 2026 San Diego street race runs on the naval base.
  "Naval Base Coronado": "San Diego Street Course",
  "Chicago Street Course": "Chicago Street Race",
  "Dover International Speedway": "Dover Motor Speedway",
};

export const FALLBACK_DRIVER_ALIASES: Record<string, string> = {
  "John Hunter Nemechek": "John H. Nemechek",
};

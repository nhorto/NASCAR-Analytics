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

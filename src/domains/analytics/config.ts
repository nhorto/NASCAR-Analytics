export const DEFAULT_SERIES_ID = 1; // Cup

/** race_type_id for championship points races (2 and 3 are exhibition variants). */
export const POINTS_RACE_TYPE_ID = 1;

/**
 * Points races whose weekend feed is broken upstream (race_type_id never set)
 * but whose loop stats exist. 5580 = 2025 YellaWood 500 — see tech-debt tracker.
 */
export const POINTS_RACE_ID_OVERRIDES: readonly number[] = [5580];

/** Width of the running-position buckets used for league-expectation baselines. */
export const PS_BUCKET_WIDTH = 5;

/** Trailing points-race window for driver form. */
export const FORM_WINDOW_RACES = 6;

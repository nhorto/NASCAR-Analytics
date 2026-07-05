export const DEFAULT_SERIES_ID = 1; // Cup

/** race_type_id for championship points races (2 and 3 are exhibition variants). */
export const POINTS_RACE_TYPE_ID = 1;

/**
 * Points races whose weekend feed is broken upstream (race_type_id never set)
 * but whose loop stats exist, so we still count them. See tech-debt tracker.
 *   5580 = 2025 YellaWood 500 (Cup)
 *   5436 = 2024 DUDE Wipes 250 (Xfinity)
 */
export const POINTS_RACE_ID_OVERRIDES: readonly number[] = [5580, 5436];

/** Width of the running-position buckets used for league-expectation baselines. */
export const PS_BUCKET_WIDTH = 5;

/** Trailing points-race window for driver form. */
export const FORM_WINDOW_RACES = 6;

/**
 * "In Form" leaders must be series regulars — having run at least this share of
 * the season's points races so far — so a part-timer's few strong starts don't
 * top the board.
 */
export const FORM_LEADER_MIN_SEASON_SHARE = 0.5;

/**
 * Proprietary-metric leaderboards restrict to loop-data regulars: drivers who
 * ran at least this share of the season's max loop-data race count. Keeps a
 * part-timer's few strong runs from topping the adjPE / Closer boards.
 */
export const METRIC_LEADER_MIN_LOOP_SHARE = 0.5;

/**
 * Points-standings cut line for the recap "playoff picture", by series. These
 * are the field SIZES (Cup 16, Xfinity 12, Trucks 10) — a simplified points-order
 * cut line, NOT the real NASCAR elimination/reset format. See tech-debt tracker.
 */
export const PLAYOFF_CUT_BY_SERIES: Record<number, number> = { 1: 16, 2: 12, 3: 10 };

/** How many over/under-performers the recap surfaces per side. */
export const RECAP_STANDOUT_COUNT = 3;

/**
 * A recap form callout needs a stable baseline: only drivers whose trailing-form
 * window (as of the prior race) covers at least this many races are eligible, so
 * a one-race "form" can't drive a callout.
 */
export const RECAP_FORM_MIN_WINDOW = 3;

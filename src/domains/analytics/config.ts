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
 * NASCAR playoff format per series (modeled window: 2017–present).
 * - `fieldSize`: drivers who make the playoffs.
 * - `roundCuts`: field size after each elimination round, in order.
 * - `roundRaces`: races in each round including the finale.
 * The playoff-race count is `sum(roundRaces)` (Cup 10, Xfinity/Trucks 7).
 */
export interface PlayoffFormat {
  fieldSize: number;
  roundCuts: number[];
  roundRaces: number[];
}

export const PLAYOFF_FORMAT_BY_SERIES: Record<number, PlayoffFormat> = {
  1: { fieldSize: 16, roundCuts: [12, 8, 4], roundRaces: [3, 3, 3, 1] }, // Cup
  2: { fieldSize: 12, roundCuts: [8, 4], roundRaces: [3, 3, 1] }, // Xfinity
  3: { fieldSize: 10, roundCuts: [8, 4], roundRaces: [3, 3, 1] }, // Trucks
};

/** Everyone in a playoff round is reset to this base; shown for context only. */
export const PLAYOFF_RESET_BASE = 2000;

/** Regular-season "win and in" also requires being inside the top N in points. */
export const PLAYOFF_WIN_ELIGIBILITY_RANK = 30;

/** How many over/under-performers the recap surfaces per side. */
export const RECAP_STANDOUT_COUNT = 3;

/**
 * A recap form callout needs a stable baseline: only drivers whose trailing-form
 * window (as of the prior race) covers at least this many races are eligible, so
 * a one-race "form" can't drive a callout.
 */
export const RECAP_FORM_MIN_WINDOW = 3;

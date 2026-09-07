// Predictions model knobs (spec §9). No external imports (architecture rule).
// Calibrated values carry provenance comments; re-derive with
// `bun run backtest:predictions --calibrate` (train = 2022–2024 Cup).
import type { LoopRatingMap, RatingWeights } from "./types.ts";

/** Simulation runs per prediction. */
export const SIM_RUNS = 5000;

/** Deterministic default seed (stage/race mixed in by the service). */
export const SIM_SEED = 20260907;

/** Trailing windows (races). */
export const TRAILING_WINDOW = 5;
export const RATING_WINDOW = 10;
export const DNF_WINDOW = 20;
export const TRACK_TYPE_WINDOW = 12;

/** Entry-list heuristic: drivers seen in the last N completed points races. */
export const ENTRY_LOOKBACK_RACES = 3;

/** Field-average expected finish for drivers with no usable history. */
export const ROOKIE_FINISH = 22;
/** Extra σ (positions) added for drivers with < MIN_PRIOR_STARTS starts. */
export const ROOKIE_EXTRA_SIGMA = 4;
export const MIN_PRIOR_STARTS = 3;

/**
 * Rating weights (finish-position units; missing components renormalize).
 * Calibrated 2026-09-07 on 2022–2024 Cup points races (grid search, Brier on
 * win/top5/top10 — see docs/research/2026-09-07_predictions-backtest.md).
 */
export const WEIGHTS: RatingWeights = {
  trailingFinish: 0.15,
  trackTypeFinish: 0.10,
  loopRating: 0.50,
  startPos: 0.25,
  dnfPenalty: 6,
};

/** Thursday runs have no qualifying: startPos weight folds into the others. */
export const WEIGHTS_NO_QUALIFYING: RatingWeights = {
  ...WEIGHTS,
  startPos: 0,
};

/**
 * Loop rating → finish-units map (finish ≈ a − b·rating). Least-squares fit
 * on 2022–2024 Cup, trailing-10 avg rating vs next-race finish (n=3878).
 */
export const LOOP_RATING_MAP: LoopRatingMap = { a: 33.7, b: 0.212 };

/**
 * Simulation noise σ (positions) per track type — how shuffled real finishes
 * are relative to the rating order. Calibrated 2026-09-07 (same run):
 * superspeedways are near-lotteries, road courses the most form-true.
 */
export const SIGMA_BY_TRACK_TYPE: Record<string, number> = {
  superspeedway: 12.5,
  intermediate: 9.0,
  short: 9.0,
  road: 8.0,
  dirt: 10.0,
  unknown: 9.5,
};

/** Laps-led allocation blend: prior share vs simulated win probability. */
export const LAPS_LED_PRIOR_BLEND = 0.6;
/** Fast-lap allocation blend: prior rate vs simulated top-5 probability. */
export const FAST_LAPS_PRIOR_BLEND = 0.6;

export const DFS_PLATFORMS = ["dk", "fd"] as const;

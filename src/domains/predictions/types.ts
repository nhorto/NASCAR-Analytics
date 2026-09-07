// Predictions domain types (spec §9). Zero runtime imports.

export type PredictionStage = "thursday" | "saturday";

/** One prior race for one driver, strictly before the target race. */
export interface PriorRaceRow {
  raceId: number;
  raceDateUtc: string | null;
  trackType: string;
  finish: number;
  start: number | null;
  dnf: boolean;
  /** Official loop-data Driver Rating; null pre-2019 / when absent. */
  rating: number | null;
  lapsLed: number;
  fastLaps: number | null;
  /** The race's actual lap count (for laps-led share); null when unknown. */
  raceLaps: number | null;
}

/** Point-in-time features for one entered driver. Null = not enough history. */
export interface DriverFeatures {
  driverId: number;
  fullName: string;
  priorStarts: number;
  /** Trailing-window average finish. */
  trailingFinish: number | null;
  /** Trailing-window average loop rating. */
  trailingRating: number | null;
  /** Average finish at this track type (capped lookback). */
  trackTypeFinish: number | null;
  /** DNF share over the trailing season window. */
  dnfRate: number;
  trailingStart: number | null;
  /** Share of available laps led over the trailing window (0..1). */
  lapsLedShare: number;
  /** Fast laps per race over the trailing window. */
  fastLapsPerRace: number;
  /** Actual starting position (saturday stage) or null (thursday). */
  startPos: number | null;
}

/**
 * Rating weights. The rating is in finish-position units (lower = better):
 * a weighted average of the finish-scale components (missing components drop
 * out and the rest renormalize) plus a DNF penalty in positions.
 */
export interface RatingWeights {
  trailingFinish: number;
  trackTypeFinish: number;
  /** Weight of the loop-rating component (mapped to finish units). */
  loopRating: number;
  startPos: number;
  /** Positions added per unit of DNF rate. */
  dnfPenalty: number;
}

/** Linear map from loop rating to finish units: finish ≈ a - b·rating. */
export interface LoopRatingMap {
  a: number;
  b: number;
}

export interface DriverPrediction {
  driverId: number;
  fullName: string;
  startPos: number | null;
  rating: number;
  pWin: number;
  pTop5: number;
  pTop10: number;
  expFinish: number;
  expLapsLed: number;
  expFastLaps: number;
}

export interface PredictionRun {
  raceId: number;
  stage: PredictionStage;
  generatedAt: string;
  /** Most recent ingested race the features saw (data-provenance stamp). */
  basisRaceId: number | null;
  predictions: DriverPrediction[];
}

export interface StoredPrediction extends DriverPrediction {
  raceId: number;
  stage: PredictionStage;
  generatedAt: string;
  basisRaceId: number | null;
}

/** DFS scoring rules — loaded from config/dfs/*.json, never hard-coded. */
export interface ScoringRules {
  platform: string;
  /** Points by finishing position; index 0 = P1. Beyond the table = 0. */
  finishPoints: number[];
  lapLedPoints: number;
  fastLapPoints: number;
  /** Points per position of (start − finish). */
  placeDiffPoints: number;
}

export interface DfsProjectionRow {
  raceId: number;
  driverId: number;
  fullName: string;
  stage: PredictionStage;
  platform: string;
  projectedPoints: number;
  projectedStart: number | null;
  generatedAt: string;
}

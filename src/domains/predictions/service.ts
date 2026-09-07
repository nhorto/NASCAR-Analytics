// Predictions service (spec §9): point-in-time features → a rating in
// finish-position units → a seeded Monte Carlo finishing-order simulation.
// Published probabilities are simulation frequencies. Everything up to the
// repo writes is pure and deterministic (mulberry32 PRNG) so the backtest and
// tests replay exactly.
import type { Providers } from "../../providers/index.ts";
import type {
  DfsProjectionRow,
  DriverFeatures,
  DriverPrediction,
  LoopRatingMap,
  PredictionRun,
  PredictionStage,
  PriorRaceRow,
  RatingWeights,
  ScoringRules,
  StoredPrediction,
} from "./types.ts";
import {
  DNF_WINDOW,
  ENTRY_LOOKBACK_RACES,
  FAST_LAPS_PRIOR_BLEND,
  LAPS_LED_PRIOR_BLEND,
  LOOP_RATING_MAP,
  MIN_PRIOR_STARTS,
  RATING_WINDOW,
  ROOKIE_EXTRA_SIGMA,
  ROOKIE_FINISH,
  SIGMA_BY_TRACK_TYPE,
  SIM_RUNS,
  SIM_SEED,
  TRACK_TYPE_WINDOW,
  TRAILING_WINDOW,
  WEIGHTS,
  WEIGHTS_NO_QUALIFYING,
} from "./config.ts";
import * as repo from "./repo.ts";

type P = Pick<Providers, "db">;

// --- deterministic randomness ---

/** mulberry32: tiny, seedable, good enough for simulation shuffling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller (one value per call). */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- features ---

function meanOf(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Features from a driver's strictly-prior races (newest first). Pure. */
export function buildFeatures(
  driverId: number,
  fullName: string,
  prior: PriorRaceRow[],
  trackType: string,
  startPos: number | null,
): DriverFeatures {
  const trailing = prior.slice(0, TRAILING_WINDOW);
  const ratingWin = prior.slice(0, RATING_WINDOW);
  const dnfWin = prior.slice(0, DNF_WINDOW);
  const atType = prior.filter((r) => r.trackType === trackType).slice(0, TRACK_TYPE_WINDOW);
  const withLaps = ratingWin.filter((r) => r.raceLaps !== null && r.raceLaps > 0);
  const lapsAvailable = withLaps.reduce((a, r) => a + (r.raceLaps ?? 0), 0);
  return {
    driverId,
    fullName,
    priorStarts: prior.length,
    trailingFinish: meanOf(trailing.map((r) => r.finish)),
    trailingRating: meanOf(ratingWin.map((r) => r.rating).filter((x): x is number => x !== null)),
    trackTypeFinish: meanOf(atType.map((r) => r.finish)),
    dnfRate: dnfWin.length === 0 ? 0 : dnfWin.filter((r) => r.dnf).length / dnfWin.length,
    trailingStart: meanOf(trailing.map((r) => r.start).filter((x): x is number => x !== null && x > 0)),
    lapsLedShare: lapsAvailable === 0 ? 0 : withLaps.reduce((a, r) => a + r.lapsLed, 0) / lapsAvailable,
    fastLapsPerRace:
      meanOf(ratingWin.map((r) => r.fastLaps).filter((x): x is number => x !== null)) ?? 0,
    startPos,
  };
}

// --- rating ---

/**
 * Rating in finish-position units (lower = better): a weighted average of the
 * available components (missing ones drop out; weights renormalize) plus a
 * DNF penalty. Pure.
 */
export function ratingFor(
  f: DriverFeatures,
  weights: RatingWeights = WEIGHTS,
  loopMap: LoopRatingMap = LOOP_RATING_MAP,
): number {
  const loopFinish =
    f.trailingRating === null
      ? null
      : Math.min(40, Math.max(1, loopMap.a - loopMap.b * f.trailingRating));
  const components: Array<[number | null, number]> = [
    [f.trailingFinish, weights.trailingFinish],
    [f.trackTypeFinish, weights.trackTypeFinish],
    [loopFinish, weights.loopRating],
    [f.startPos, weights.startPos],
  ];
  let sum = 0;
  let wsum = 0;
  for (const [value, w] of components) {
    if (value === null || w === 0) continue;
    sum += value * w;
    wsum += w;
  }
  const base = wsum === 0 ? ROOKIE_FINISH : sum / wsum;
  return base + weights.dnfPenalty * f.dnfRate;
}

// --- simulation ---

export interface SimEntry {
  driverId: number;
  rating: number;
  /** Extra σ for thin history (rookies). */
  extraSigma: number;
}

export interface SimOutcome {
  pWin: number;
  pTop5: number;
  pTop10: number;
  expFinish: number;
}

/**
 * Seeded finishing-order simulation: each run draws score = rating + σ·z,
 * sorts ascending, tallies. Deterministic for a given (entries order, seed).
 */
export function simulateField(
  entries: SimEntry[],
  sigma: number,
  runs: number,
  seed: number,
): Map<number, SimOutcome> {
  const n = entries.length;
  const rng = mulberry32(seed);
  const wins = new Array<number>(n).fill(0);
  const top5 = new Array<number>(n).fill(0);
  const top10 = new Array<number>(n).fill(0);
  const finishSum = new Array<number>(n).fill(0);
  const order = entries.map((_, i) => i);
  const scores = new Array<number>(n).fill(0);
  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < n; i++)
      scores[i] = entries[i]!.rating + (sigma + entries[i]!.extraSigma) * gaussian(rng);
    order.sort((a, b) => scores[a]! - scores[b]!);
    for (let pos = 0; pos < n; pos++) {
      const i = order[pos]!;
      finishSum[i] = finishSum[i]! + pos + 1;
      if (pos === 0) wins[i] = wins[i]! + 1;
      if (pos < 5) top5[i] = top5[i]! + 1;
      if (pos < 10) top10[i] = top10[i]! + 1;
    }
  }
  const out = new Map<number, SimOutcome>();
  for (let i = 0; i < n; i++) {
    out.set(entries[i]!.driverId, {
      pWin: wins[i]! / runs,
      pTop5: top5[i]! / runs,
      pTop10: top10[i]! / runs,
      expFinish: finishSum[i]! / runs,
    });
  }
  return out;
}

/** Allocate a race-long total (laps led / fastest laps) across the field by a
 *  prior-share ⊕ simulated-odds propensity. Pure; returns per-driver counts. */
export function allocateTotal(
  drivers: Array<{ driverId: number; priorShare: number; simOdds: number }>,
  total: number,
  priorBlend: number,
): Map<number, number> {
  const priorSum = drivers.reduce((a, d) => a + d.priorShare, 0);
  const oddsSum = drivers.reduce((a, d) => a + d.simOdds, 0);
  let weightSum = 0;
  const weights = drivers.map((d) => {
    const prior = priorSum === 0 ? 1 / drivers.length : d.priorShare / priorSum;
    const odds = oddsSum === 0 ? 1 / drivers.length : d.simOdds / oddsSum;
    const w = priorBlend * prior + (1 - priorBlend) * odds;
    weightSum += w;
    return w;
  });
  const out = new Map<number, number>();
  drivers.forEach((d, i) => out.set(d.driverId, weightSum === 0 ? 0 : (weights[i]! / weightSum) * total));
  return out;
}

// --- DFS scoring ---

/** Validate a config/dfs/*.json payload. Throws with the exact problem. */
export function parseScoringRules(raw: unknown, source: string): ScoringRules {
  const bad = (why: string): never => {
    throw new Error(`Invalid DFS scoring config ${source}: ${why}`);
  };
  if (typeof raw !== "object" || raw === null) bad("not an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.platform !== "string" || o.platform === "") bad("missing platform");
  if (!Array.isArray(o.finishPoints) || o.finishPoints.length < 30) bad("finishPoints must list ≥30 positions");
  if (!(o.finishPoints as unknown[]).every((x) => typeof x === "number" && Number.isFinite(x)))
    bad("finishPoints must be numbers");
  for (const k of ["lapLedPoints", "fastLapPoints", "placeDiffPoints"] as const) {
    if (typeof o[k] !== "number" || !Number.isFinite(o[k] as number)) bad(`missing numeric ${k}`);
  }
  return {
    platform: o.platform as string,
    finishPoints: o.finishPoints as number[],
    lapLedPoints: o.lapLedPoints as number,
    fastLapPoints: o.fastLapPoints as number,
    placeDiffPoints: o.placeDiffPoints as number,
  };
}

/** Finish points for a (possibly fractional) expected finish: linear
 *  interpolation between adjacent table positions; 0 beyond the table. */
export function finishPointsFor(expFinish: number, rules: ScoringRules): number {
  const table = rules.finishPoints;
  const at = (pos: number) => (pos >= 1 && pos <= table.length ? table[pos - 1]! : 0);
  const lo = Math.floor(expFinish);
  const hi = Math.ceil(expFinish);
  if (lo === hi) return at(lo);
  const frac = expFinish - lo;
  return at(lo) * (1 - frac) + at(hi) * frac;
}

/** Projected DFS points for one driver. Pure — the hand-check target. */
export function scoreDfs(
  pred: { expFinish: number; expLapsLed: number; expFastLaps: number },
  projectedStart: number | null,
  rules: ScoringRules,
): number {
  const finish = finishPointsFor(pred.expFinish, rules);
  const laps = pred.expLapsLed * rules.lapLedPoints + pred.expFastLaps * rules.fastLapPoints;
  const diff = projectedStart === null ? 0 : (projectedStart - pred.expFinish) * rules.placeDiffPoints;
  return finish + laps + diff;
}

// --- orchestration ---

export interface GenerateOptions {
  raceId: number;
  stage: PredictionStage;
  /** driver_id → starting position (saturday). Absent → form-only weights. */
  startPositions?: Map<number, number>;
  now?: Date;
  seed?: number;
  /** Persist to race_predictions/dfs_projections (default true). */
  write?: boolean;
  scoringRules?: ScoringRules[];
  weights?: RatingWeights;
  sigmaByTrackType?: Record<string, number>;
  simRuns?: number;
}

/** Default per-(race, stage) seed so republishing is reproducible. */
export function seedFor(raceId: number, stage: PredictionStage): number {
  return (SIM_SEED ^ Math.imul(raceId, 2654435761) ^ (stage === "saturday" ? 0x9e37 : 0)) >>> 0;
}

export function generatePredictions(
  p: P,
  opts: GenerateOptions,
): { run: PredictionRun; projections: DfsProjectionRow[] } {
  const race = repo.raceInfo(p.db, opts.raceId);
  if (!race) throw new Error(`Race ${opts.raceId} not found`);
  if (!race.raceDateUtc) throw new Error(`Race ${opts.raceId} has no date — cannot bound features`);
  const generatedAt = (opts.now ?? new Date()).toISOString();
  const entryRaceIds = repo.lastCompletedRaceIds(p.db, race.seriesId, race.raceDateUtc, ENTRY_LOOKBACK_RACES);
  if (entryRaceIds.length === 0) throw new Error(`No completed races before ${race.raceName} to build from`);

  const useStarts = opts.stage === "saturday" && !!opts.startPositions && opts.startPositions.size > 0;
  const weights = opts.weights ?? (useStarts ? WEIGHTS : WEIGHTS_NO_QUALIFYING);
  const features = repo.driversInRaces(p.db, entryRaceIds).map((d) =>
    buildFeatures(
      d.driverId,
      d.fullName,
      repo.priorRaces(p.db, d.driverId, race.seriesId, race.raceDateUtc!, 60),
      race.trackType,
      useStarts ? (opts.startPositions!.get(d.driverId) ?? null) : null,
    ),
  );

  const sigma = (opts.sigmaByTrackType ?? SIGMA_BY_TRACK_TYPE)[race.trackType] ?? SIGMA_BY_TRACK_TYPE.unknown!;
  const sim = simulateField(
    features.map((f) => ({
      driverId: f.driverId,
      rating: ratingFor(f, weights),
      extraSigma: f.priorStarts < MIN_PRIOR_STARTS ? ROOKIE_EXTRA_SIGMA : 0,
    })),
    sigma,
    opts.simRuns ?? SIM_RUNS,
    opts.seed ?? seedFor(opts.raceId, opts.stage),
  );

  const totalLaps = race.scheduledLaps ?? 300;
  const lapsLed = allocateTotal(
    features.map((f) => ({ driverId: f.driverId, priorShare: f.lapsLedShare, simOdds: sim.get(f.driverId)!.pWin })),
    totalLaps, LAPS_LED_PRIOR_BLEND,
  );
  const fastLaps = allocateTotal(
    features.map((f) => ({ driverId: f.driverId, priorShare: f.fastLapsPerRace, simOdds: sim.get(f.driverId)!.pTop5 })),
    totalLaps, FAST_LAPS_PRIOR_BLEND,
  );

  const predictions: DriverPrediction[] = features
    .map((f) => ({
      driverId: f.driverId,
      fullName: f.fullName,
      startPos: f.startPos,
      rating: ratingFor(f, weights),
      ...sim.get(f.driverId)!,
      expLapsLed: lapsLed.get(f.driverId)!,
      expFastLaps: fastLaps.get(f.driverId)!,
    }))
    .sort((a, b) => b.pWin - a.pWin || a.expFinish - b.expFinish);

  const run: PredictionRun = {
    raceId: race.raceId, stage: opts.stage, generatedAt, basisRaceId: entryRaceIds[0] ?? null, predictions,
  };
  const trailingStarts = new Map(features.map((f) => [f.driverId, f.trailingStart]));
  const projections = (opts.scoringRules ?? []).flatMap((rules) =>
    predictions.map((pred) => ({
      raceId: race.raceId, driverId: pred.driverId, fullName: pred.fullName, stage: opts.stage,
      platform: rules.platform,
      projectedPoints: scoreDfs(pred, pred.startPos ?? trailingStarts.get(pred.driverId) ?? null, rules),
      projectedStart: pred.startPos ?? trailingStarts.get(pred.driverId) ?? null,
      generatedAt,
    })),
  );

  if (opts.write !== false) {
    const stored: StoredPrediction[] = predictions.map((pred) => ({
      ...pred, raceId: race.raceId, stage: opts.stage, generatedAt, basisRaceId: run.basisRaceId,
    }));
    repo.upsertPredictions(p.db, stored);
    if (projections.length > 0) repo.upsertProjections(p.db, projections);
  }
  return { run, projections };
}

// --- reads for pages/CLI ---

export const raceInfo = (p: P, raceId: number) => repo.raceInfo(p.db, raceId);
export const nextRaceWithoutResults = (p: P, seriesId: number, nowIso: string) =>
  repo.nextRaceWithoutResults(p.db, seriesId, nowIso);
export const latestPredictions = (p: P, raceId: number) => repo.latestPredictions(p.db, raceId);
export const latestPredictedRaceId = (p: P, seriesId: number) =>
  repo.latestPredictedRaceId(p.db, seriesId);
export const latestProjections = (p: P, raceId: number, platform: string) =>
  repo.latestProjections(p.db, raceId, platform);
export const startingPositions = (p: P, raceId: number) => repo.startingPositions(p.db, raceId);
export const actualFinishes = (p: P, raceId: number) => repo.actualFinishes(p.db, raceId);
export const lastCompletedRaceIds = (p: P, seriesId: number, beforeDateUtc: string, limit: number) =>
  repo.lastCompletedRaceIds(p.db, seriesId, beforeDateUtc, limit);

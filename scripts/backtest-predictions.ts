// WS-F honesty bar (spec §9): evaluate the prediction model on a held-out
// season against two baselines — uniform, and "trailing-5 average finish"
// pushed through the SAME simulation machinery (so the comparison isolates
// the rating, not the probability plumbing).
//
//   bun run backtest:predictions                    # evaluate 2025 (held out)
//   bun run backtest:predictions --seasons 2023     # sanity on a train year
//   bun run backtest:predictions --calibrate        # σ/weights search on 2022–2024
//   bun run backtest:predictions --runs 2000        # faster, noisier sims
//
// Results: docs/research/2026-09-07_predictions-backtest.md
import { createProviders } from "../src/providers/index.ts";
import { predictionsService, predictionsConfig, type RatingWeights } from "../src/domains/predictions/index.ts";

const DATA_DIR = process.env.NASCAR_DATA_DIR ?? "data";
const p = createProviders({
  dbPath: `${DATA_DIR}/nascar.db`,
  archiveDir: null,
  cdn: { delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "backtest" },
});

const argNum = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const SIM_RUNS = argNum("--runs", 4000);

const TRAILING5_BASELINE: RatingWeights = {
  trailingFinish: 1, trackTypeFinish: 0, loopRating: 0, startPos: 0, dnfPenalty: 0,
};

interface Sample { prob: number; hit: boolean }
interface SeasonEval {
  races: number;
  samples: number;
  coverage: number; // share of actual finishers the entry heuristic covered
  brier: { win: number; top5: number; top10: number };
  calib: Sample[]; // pooled win/top5/top10 samples for the calibration table
}

function pointsRacesOf(season: number): number[] {
  return (
    p.db
      .query(
        `SELECT r.race_id AS raceId FROM races r
         WHERE r.series_id = 1 AND (r.race_type_id = 1 OR r.race_id = 5580) AND r.season = ?
           AND EXISTS (SELECT 1 FROM results res WHERE res.race_id = r.race_id)
         ORDER BY r.race_date_utc`,
      )
      .all(season) as Array<{ raceId: number }>
  ).map((r) => r.raceId);
}

function evaluateSeason(
  season: number,
  opts: {
    weights?: RatingWeights;
    sigmaByTrackType?: Record<string, number>;
    stage: "thursday" | "saturday";
    uniform?: boolean;
  },
): SeasonEval {
  const brierSum = { win: 0, top5: 0, top10: 0 };
  const calib: Sample[] = [];
  let samples = 0;
  let covered = 0;
  let fieldTotal = 0;
  let races = 0;
  for (const raceId of pointsRacesOf(season)) {
    const actual = predictionsService.actualFinishes(p, raceId);
    if (actual.size < 20) continue; // shortened/odd fields corrupt the tally
    let probs: Map<number, { pWin: number; pTop5: number; pTop10: number }>;
    if (opts.uniform) {
      const n = actual.size;
      probs = new Map([...actual.keys()].map((id) => [id, { pWin: 1 / n, pTop5: 5 / n, pTop10: 10 / n }]));
    } else {
      const { run } = predictionsService.generatePredictions(p, {
        raceId,
        stage: opts.stage,
        startPositions: opts.stage === "saturday" ? predictionsService.startingPositions(p, raceId) : undefined,
        write: false,
        weights: opts.weights,
        sigmaByTrackType: opts.sigmaByTrackType,
        simRuns: SIM_RUNS,
      });
      probs = new Map(run.predictions.map((d) => [d.driverId, d]));
    }
    races++;
    fieldTotal += actual.size;
    for (const [driverId, res] of actual) {
      const pr = probs.get(driverId);
      if (!pr) continue; // missed by the entry heuristic — counted in coverage
      covered++;
      samples++;
      const events: Array<[number, boolean]> = [
        [pr.pWin, res.finish === 1],
        [pr.pTop5, res.finish <= 5],
        [pr.pTop10, res.finish <= 10],
      ];
      brierSum.win += (events[0]![0] - (events[0]![1] ? 1 : 0)) ** 2;
      brierSum.top5 += (events[1]![0] - (events[1]![1] ? 1 : 0)) ** 2;
      brierSum.top10 += (events[2]![0] - (events[2]![1] ? 1 : 0)) ** 2;
      for (const [prob, hit] of events) calib.push({ prob, hit });
    }
  }
  return {
    races,
    samples,
    coverage: fieldTotal === 0 ? 0 : covered / fieldTotal,
    brier: {
      win: brierSum.win / samples,
      top5: brierSum.top5 / samples,
      top10: brierSum.top10 / samples,
    },
    calib,
  };
}

function calibrationTable(calib: Sample[]): Array<{ bin: string; n: number; predicted: number; actual: number }> {
  const rows: Array<{ bin: string; n: number; predicted: number; actual: number }> = [];
  for (let lo = 0; lo < 100; lo += 10) {
    const inBin = calib.filter((s) => s.prob * 100 >= lo && s.prob * 100 < lo + 10);
    if (inBin.length === 0) continue;
    rows.push({
      bin: `${lo}–${lo + 10}%`,
      n: inBin.length,
      predicted: (inBin.reduce((a, s) => a + s.prob, 0) / inBin.length) * 100,
      actual: (inBin.filter((s) => s.hit).length / inBin.length) * 100,
    });
  }
  return rows;
}

function printEval(label: string, ev: SeasonEval): void {
  console.log(
    `${label.padEnd(34)} races ${ev.races}  n ${ev.samples}  cover ${(ev.coverage * 100).toFixed(1)}%  ` +
      `Brier win ${ev.brier.win.toFixed(5)}  top5 ${ev.brier.top5.toFixed(4)}  top10 ${ev.brier.top10.toFixed(4)}`,
  );
}

if (process.argv.includes("--calibrate")) {
  // Coarse σ + weight search on the train years. Not exhaustive — the point
  // is a defensible setting, re-derivable, with the eval season untouched.
  const TRAIN = [2022, 2023, 2024];
  const evalTrain = (weights: RatingWeights, sigma: Record<string, number>) => {
    let win = 0, top10 = 0, n = 0;
    for (const season of TRAIN) {
      const ev = evaluateSeason(season, { weights, sigmaByTrackType: sigma, stage: "saturday" });
      win += ev.brier.win * ev.samples; top10 += ev.brier.top10 * ev.samples; n += ev.samples;
    }
    return { win: win / n, top10: top10 / n };
  };

  console.log("— σ grid (all track types shifted together, base weights) —");
  for (const shift of [-2, -1, 0, 1, 2]) {
    const sigma = Object.fromEntries(
      Object.entries(predictionsConfig.SIGMA_BY_TRACK_TYPE).map(([k, v]) => [k, v + shift]),
    );
    const r = evalTrain(predictionsConfig.WEIGHTS, sigma);
    console.log(`  σ${shift >= 0 ? "+" : ""}${shift}: win ${r.win.toFixed(5)}  top10 ${r.top10.toFixed(4)}`);
  }

  console.log("— weight variants (calibrated σ) —");
  const variants: Array<[string, RatingWeights]> = [
    ["base", predictionsConfig.WEIGHTS],
    ["loop-50", { trailingFinish: 0.15, trackTypeFinish: 0.10, loopRating: 0.50, startPos: 0.25, dnfPenalty: 6 }],
    ["loop-60", { trailingFinish: 0.10, trackTypeFinish: 0.10, loopRating: 0.60, startPos: 0.20, dnfPenalty: 6 }],
    ["no-tt", { trailingFinish: 0.25, trackTypeFinish: 0, loopRating: 0.45, startPos: 0.30, dnfPenalty: 6 }],
    ["dnf-3", { ...predictionsConfig.WEIGHTS, dnfPenalty: 3 }],
    ["start-35", { trailingFinish: 0.15, trackTypeFinish: 0.10, loopRating: 0.40, startPos: 0.35, dnfPenalty: 6 }],
  ];
  for (const [name, weights] of variants) {
    const r = evalTrain(weights, predictionsConfig.SIGMA_BY_TRACK_TYPE);
    console.log(`  ${name.padEnd(12)} win ${r.win.toFixed(5)}  top10 ${r.top10.toFixed(4)}`);
  }
  process.exit(0);
}

// --- evaluation (held-out unless --seasons overrides) ---
const season = argNum("--seasons", 2025);
console.log(`Held-out evaluation — season ${season}, ${SIM_RUNS} sims/race\n`);

const saturday = evaluateSeason(season, { stage: "saturday" });
const thursday = evaluateSeason(season, { stage: "thursday" });
const trailing5 = evaluateSeason(season, { weights: TRAILING5_BASELINE, stage: "saturday" });
const uniform = evaluateSeason(season, { stage: "saturday", uniform: true });

printEval("model (saturday, with quals)", saturday);
printEval("model (thursday, form only)", thursday);
printEval("baseline: trailing-5 (same sim)", trailing5);
printEval("baseline: uniform", uniform);

console.log("\nCalibration (saturday model, pooled win/top5/top10):");
console.log("  bin        n     predicted  actual   |gap|");
for (const row of calibrationTable(saturday.calib)) {
  const gap = Math.abs(row.predicted - row.actual);
  const flag = row.n >= 30 && gap > 5 ? "  ⚠ >±5" : "";
  console.log(
    `  ${row.bin.padEnd(9)} ${String(row.n).padStart(5)}  ${row.predicted.toFixed(1).padStart(8)}%  ${row.actual
      .toFixed(1)
      .padStart(5)}%  ${gap.toFixed(1).padStart(5)}${flag}`,
  );
}

const beats =
  saturday.brier.win < trailing5.brier.win &&
  saturday.brier.win < uniform.brier.win &&
  saturday.brier.top5 < trailing5.brier.top5 &&
  saturday.brier.top5 < uniform.brier.top5 &&
  saturday.brier.top10 < trailing5.brier.top10 &&
  saturday.brier.top10 < uniform.brier.top10;
console.log(`\nHonesty bar (beats BOTH baselines on win+top5+top10 Brier): ${beats ? "✅ PASS" : "❌ FAIL"}`);

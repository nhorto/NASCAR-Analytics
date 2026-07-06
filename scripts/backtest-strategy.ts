// Phase 4 — backtest the strategy model's pit-cadence prediction on HELD-OUT
// races, and publish error bars.
//
//   bun run backtest [--test-season 2022]
//
// Temporal holdout (predict the future from the past): calibrate the typical
// green-flag run per track on the TRAIN seasons, then measure how well it
// predicts individual green-stint lengths in the held-out TEST season — versus
// three baselines, to show exactly what the per-track calibration buys:
//   flat40  — the old DEFAULT_STINT_LAPS constant
//   global  — one median green run across all tracks (per series)
//   byType  — median per track type
//   byTrack — median per track (→ type → global fallback), i.e. the shipped model
//
// A green stint's next-pit-lap = startLap + length, and startLap is known, so
// |predicted length − actual length| == |predicted pit lap − actual pit lap|.
// We predict length. Writes docs/research/2026-07-06_strategy-backtest.md.
import { Database } from "bun:sqlite";
import { liveService, liveConfig } from "../src/domains/live/index.ts";
import type { NormalizedPitStop } from "../src/domains/live/index.ts";

const DATA_DIR = process.env.NASCAR_DATA_DIR ?? "data";
const argN = (flag: string, fb: number) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fb : Number.parseInt(process.argv[i + 1] ?? "", 10) || fb;
};
const TEST_SEASON = argN("--test-season", 2022);
const FLAT = liveConfig.DEFAULT_STINT_LAPS;

function pitStopsFromWeekendPitReports(reports: any[]): NormalizedPitStop[] {
  if (!Array.isArray(reports)) return [];
  const pick = (o: any, keys: string[]) => { for (const k of keys) if (o[k] != null) return o[k]; return undefined; };
  const out: NormalizedPitStop[] = [];
  for (const r of reports) {
    const lap = Number(pick(r, ["lap_count", "pit_in_lap_count", "leader_lap", "lap"])) || 0;
    if (lap <= 0) continue;
    const tires = [r.left_front_tire_changed, r.left_rear_tire_changed, r.right_front_tire_changed, r.right_rear_tire_changed].filter(Boolean).length;
    out.push({ carNumber: String(pick(r, ["vehicle_number", "car_number"]) ?? ""), driverId: null, lap, flagStatus: Number(pick(r, ["pit_in_flag_status", "flag_status"]) ?? 0), tiresChanged: tires });
  }
  return out;
}

const db = new Database(`${DATA_DIR}/nascar.db`, { readonly: true });

interface Race { race_id: number; track_id: number; track_type: string; season: number; actual_laps: number | null }
interface Sample { trackId: number; trackType: string; length: number }

// Pull every clean green stint length for a series, split by train/test season.
async function greenStints(series: number): Promise<{ train: Sample[]; test: Sample[] }> {
  const races = db.query<Race, [number]>(
    `SELECT race_id, track_id, track_type, season, actual_laps FROM races WHERE series_id = ? AND actual_laps IS NOT NULL`,
  ).all(series);
  const train: Sample[] = [], test: Sample[] = [];
  for (const race of races) {
    const laps = race.actual_laps ?? 0;
    if (laps <= 0) continue;
    const f = Bun.file(`${DATA_DIR}/raw/${race.season}/${series}/${race.race_id}/weekend-feed.json`);
    if (!(await f.exists())) continue;
    let pits: NormalizedPitStop[] = [];
    try { const wf = await f.json(); pits = pitStopsFromWeekendPitReports(wf?.weekend_race?.[0]?.pit_reports ?? []); } catch { continue; }
    if (!pits.length) continue;
    const lens = liveService.greenStintLengths(liveService.reconstructStints(pits, laps));
    const bucket = race.season >= TEST_SEASON ? test : train;
    for (const len of lens) bucket.push({ trackId: race.track_id, trackType: race.track_type, length: len });
  }
  return { train, test };
}

// Fit the four predictors on the training samples.
function fit(train: Sample[]) {
  const all = train.map((s) => s.length);
  const global = liveService.median(all) ?? FLAT;
  const byType = new Map<string, number>();
  const byTrack = new Map<number, number>();
  const groupType = new Map<string, number[]>();
  const groupTrack = new Map<number, number[]>();
  for (const s of train) {
    (groupType.get(s.trackType) ?? groupType.set(s.trackType, []).get(s.trackType)!).push(s.length);
    (groupTrack.get(s.trackId) ?? groupTrack.set(s.trackId, []).get(s.trackId)!).push(s.length);
  }
  for (const [t, xs] of groupType) { const m = liveService.median(xs); if (m != null) byType.set(t, m); }
  for (const [t, xs] of groupTrack) if (xs.length >= liveConfig.MIN_GREEN_STINT_SAMPLES) { const m = liveService.median(xs); if (m != null) byTrack.set(t, m); }
  return { global, byType, byTrack };
}

const PREDICTORS = ["flat40", "global", "byType", "byTrack"] as const;
type Pred = (typeof PREDICTORS)[number];

function predict(kind: Pred, s: Sample, m: ReturnType<typeof fit>): number {
  if (kind === "flat40") return FLAT;
  if (kind === "global") return m.global;
  if (kind === "byType") return m.byType.get(s.trackType) ?? m.global;
  return m.byTrack.get(s.trackId) ?? m.byType.get(s.trackType) ?? m.global; // byTrack, with fallback
}

interface Metrics { n: number; mae: number; medAE: number; p90AE: number; cov5: number; cov10: number }
function metrics(errs: number[]): Metrics {
  if (!errs.length) return { n: 0, mae: 0, medAE: 0, p90AE: 0, cov5: 0, cov10: 0 };
  const s = errs.slice().sort((a, b) => a - b);
  const pct = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
  return {
    n: errs.length,
    mae: errs.reduce((a, b) => a + b, 0) / errs.length,
    medAE: pct(50),
    p90AE: pct(90),
    cov5: errs.filter((e) => e <= 5).length / errs.length,
    cov10: errs.filter((e) => e <= 10).length / errs.length,
  };
}

// Accumulate errors overall, per series, and per track-type.
const overall: Record<Pred, number[]> = { flat40: [], global: [], byType: [], byTrack: [] };
const perSeries: Record<number, Record<Pred, number[]>> = {};
const perType: Record<string, Record<Pred, number[]>> = {};
const trainTestCounts: Record<number, { train: number; test: number }> = {};

for (const series of [1, 2, 3]) {
  const { train, test } = await greenStints(series);
  trainTestCounts[series] = { train: train.length, test: test.length };
  const model = fit(train);
  perSeries[series] = { flat40: [], global: [], byType: [], byTrack: [] };
  for (const s of test) {
    for (const kind of PREDICTORS) {
      const err = Math.abs(predict(kind, s, model) - s.length);
      overall[kind].push(err);
      perSeries[series]![kind].push(err);
      (perType[s.trackType] ??= { flat40: [], global: [], byType: [], byTrack: [] })[kind].push(err);
    }
  }
}

// ---- report ----
const fmtRow = (label: string, m: Metrics) =>
  `${label.padEnd(14)} n=${String(m.n).padStart(4)}  MAE ${m.mae.toFixed(1).padStart(5)}  medAE ${m.medAE.toFixed(1).padStart(4)}  p90 ${m.p90AE.toFixed(1).padStart(4)}  ±5 ${(m.cov5 * 100).toFixed(0).padStart(3)}%  ±10 ${(m.cov10 * 100).toFixed(0).padStart(3)}%`;

console.log(`\nStrategy backtest — held-out test season ${TEST_SEASON}+ (train < ${TEST_SEASON}); predicting green-stint length (laps)\n`);
for (const s of [1, 2, 3]) console.log(`  series ${s}: train ${trainTestCounts[s]!.train} stints, test ${trainTestCounts[s]!.test} stints`);

console.log("\n== OVERALL (all series) ==");
for (const kind of PREDICTORS) console.log("  " + fmtRow(kind, metrics(overall[kind])));

const baseMAE = metrics(overall.flat40).mae, gMAE = metrics(overall.global).mae, tMAE = metrics(overall.byTrack).mae;
console.log(`\n  byTrack vs flat40: ${(((baseMAE - tMAE) / baseMAE) * 100).toFixed(0)}% lower MAE (${baseMAE.toFixed(1)} → ${tMAE.toFixed(1)} laps)`);
console.log(`  byTrack vs global: ${(((gMAE - tMAE) / gMAE) * 100).toFixed(0)}% lower MAE (${gMAE.toFixed(1)} → ${tMAE.toFixed(1)} laps)`);

console.log("\n== per track-type (byTrack predictor) ==");
for (const [type, recs] of Object.entries(perType)) console.log("  " + fmtRow(type, metrics(recs.byTrack)));

// ---- markdown artifact ----
const mdRow = (label: string, m: Metrics) =>
  `| ${label} | ${m.n} | ${m.mae.toFixed(1)} | ${m.medAE.toFixed(1)} | ${m.p90AE.toFixed(1)} | ${(m.cov5 * 100).toFixed(0)}% | ${(m.cov10 * 100).toFixed(0)}% |`;
const md = `# Strategy Model Backtest — pit-cadence prediction (Phase 4)

**Generated by** \`bun run backtest\` on the historical backfill. **Held-out** test
season **${TEST_SEASON}+**, trained on seasons **< ${TEST_SEASON}** (temporal split —
predict the newer season from older history; no leakage). Target: predict a car's
green-flag **stint length** (== next green pit lap, since the stint start is known).

Predictors, in increasing sophistication:
- **flat40** — the old \`DEFAULT_STINT_LAPS\` constant (what the calibration replaced)
- **global** — one median green run across all tracks (per series)
- **byType** — median per track type
- **byTrack** — median per track (→ type → global fallback) — **the shipped model**

Error = |predicted − actual| laps. MAE = mean abs error; medAE = median; p90 = 90th
pct; ±5 / ±10 = share of held-out stints predicted within that many laps.

## Overall (all three series)

| Predictor | n | MAE | medAE | p90 | ±5 | ±10 |
|-----------|---|-----|-------|-----|----|-----|
${PREDICTORS.map((k) => mdRow(k, metrics(overall[k]))).join("\n")}

**byTrack vs flat40:** ${(((baseMAE - tMAE) / baseMAE) * 100).toFixed(0)}% lower MAE (${baseMAE.toFixed(1)} → ${tMAE.toFixed(1)} laps).
**byTrack vs global:** ${(((gMAE - tMAE) / gMAE) * 100).toFixed(0)}% lower MAE (${gMAE.toFixed(1)} → ${tMAE.toFixed(1)} laps).

## Per track type (byTrack predictor)

| Track type | n | MAE | medAE | p90 | ±5 | ±10 |
|-----------|---|-----|-------|-----|----|-----|
${Object.entries(perType).map(([t, r]) => mdRow(t, metrics(r.byTrack))).join("\n")}

## Per series (byTrack predictor)

| Series | train stints | test stints | MAE | medAE | ±10 |
|--------|--------------|-------------|-----|-------|-----|
${[1, 2, 3].map((s) => { const m = metrics(perSeries[s]!.byTrack); return `| ${s} | ${trainTestCounts[s]!.train} | ${trainTestCounts[s]!.test} | ${m.mae.toFixed(1)} | ${m.medAE.toFixed(1)} | ${(m.cov10 * 100).toFixed(0)}% |`; }).join("\n")}

## Reading this honestly

Green-stint length is high-variance — teams pit early for **track position** and
**cautions**, not just fuel/tires — so no point estimate can drive the MAE to zero;
that irreducible spread is the floor. The backtest's real question is **relative**:
does per-track (and per-type) calibration beat the flat constant on races it never
saw? The tire-severity tier is validated separately by face-validity ordering
(Darlington highest → Talladega lowest, cross-series consistent), not a numeric
held-out backtest, since there is no ground-truth tire-wear label to score against.
`;
await Bun.write("docs/research/2026-07-06_strategy-backtest.md", md);
console.log("\nwrote docs/research/2026-07-06_strategy-backtest.md");
db.close();

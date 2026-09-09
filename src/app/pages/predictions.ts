// /predictions + methodology contents (WS-F, spec §8/§9). Pro sees the full
// table; free viewers get the top three plus decorative blurred rows (real
// rows never reach a non-Pro client). Every view carries the generation stamp.
import { esc, card, fmt, fmtDate, pct } from "../html.ts";
import type { PredictionStage, StoredPrediction } from "../../domains/predictions/index.ts";

// Headline numbers from the held-out backtest, shown on the methodology page
// and served to the native app alongside the predictions themselves (WS-J) so
// the two surfaces can never quote different numbers.
// Source: docs/research/2026-09-07_predictions-backtest.md (re-derive with
// `bun run backtest:predictions`).
export const METHODOLOGY_BACKTEST = {
  evalSeason: 2025,
  winBrier: "0.0255 vs 0.0268 trailing-5 and 0.0256 uniform",
  top10Brier: "0.173 vs 0.194 for both baselines, about 11% better",
  calibrationNote:
    "Calibration is inside ±5 points on six of seven probability bins; the seventh (60–70%, n=39) sits 5.2 off — within one standard error of exact. Win odds firm up after qualifying: the Thursday form-only run is honest about being weaker on outright winners.",
} as const;

/** The Picks surface's Predictions ⇄ DFS switch, shared by both pages. */
export function picksSeg(current: "predictions" | "dfs"): string {
  return `<nav class="seg picks-seg"><a href="/predictions" class="${current === "predictions" ? "on" : ""}">Predictions</a><a href="/dfs" class="${current === "dfs" ? "on" : ""}">DFS</a></nav>`;
}

export interface PredictionsView {
  raceName: string;
  season: number;
  trackType: string;
  stage: PredictionStage;
  generatedAt: string;
  basisRaceId: number | null;
  rows: Array<StoredPrediction & { fullName: string }>;
  /** driver_id → actual finish, when the race has been run. */
  actual: Map<number, { finish: number; lapsLed: number }> | null;
  viewerPro: boolean;
}

function stampNote(view: PredictionsView): string {
  const stageLabel = view.stage === "saturday" ? "post-qualifying (Saturday)" : "form-based (Thursday)";
  return `<p class="note">Generated ${esc(new Date(view.generatedAt).toUTCString())} · ${stageLabel} · built from data through race ${view.basisRaceId ?? "?"} · <a href="/predictions/methodology">how this works</a></p>`;
}

function predictionRow(r: StoredPrediction & { fullName: string }, actual: PredictionsView["actual"]): string {
  const act = actual?.get(r.driverId) ?? null;
  const actCells = actual
    ? `<td class="num">${act ? act.finish : "—"}</td><td class="num">${act ? (act.finish <= Math.round(r.expFinish) ? "✓" : "") : ""}</td>`
    : "";
  return `<tr><td>${esc(r.fullName)}</td><td class="num">${pct(r.pWin)}</td><td class="num">${pct(r.pTop5)}</td><td class="num">${pct(r.pTop10)}</td><td class="num">${fmt(r.expFinish)}</td>${actCells}</tr>`;
}

const BLURRED_ROW = `<tr><td>————— ———</td><td class="num">——</td><td class="num">——</td><td class="num">——</td><td class="num">——</td></tr>`;

export function predictionsContent(view: PredictionsView): string {
  const header = `<thead><tr><th>Driver</th><th>Win</th><th>Top 5</th><th>Top 10</th><th>Exp fin</th>${
    view.actual ? "<th>Actual</th><th></th>" : ""
  }</tr></thead>`;
  let body: string;
  let cta = "";
  if (view.viewerPro) {
    body = view.rows.map((r) => predictionRow(r, view.actual)).join("\n");
  } else {
    const visible = view.rows.slice(0, 3).map((r) => predictionRow(r, view.actual)).join("\n");
    const hidden = Math.max(0, view.rows.length - 3);
    body = `${visible}\n${BLURRED_ROW.repeat(Math.min(hidden, 8))}`;
    cta = `<div class="teaser-lock teaser-lock-rows"><p><b>${hidden} more drivers with Pro</b></p><a class="teaser-cta" href="/pricing">See Pro — $9.99/mo or $69/season</a></div>`;
  }
  const table = `<div class="${view.viewerPro ? "" : "teaser-wrap"}"><table class="pred-table${view.viewerPro ? "" : " pred-free"}">${header}<tbody>${body}</tbody></table>${cta}</div>`;
  const title = view.actual ? `${view.raceName} — predicted vs actual` : `${view.raceName} — predictions`;
  return `${card(title, `${stampNote(view)}${table}`)}`;
}

export function predictionsEmptyContent(): string {
  return card(
    "Predictions",
    `<p class="note">No prediction run is stored yet — the model publishes Thursday (form) and Saturday (after qualifying) each race week.</p>
<p class="note"><a href="/predictions/methodology">How the model works →</a></p>`,
  );
}

export function cupOnlyContent(seriesLabel: string): string {
  return card(
    "Predictions",
    `<p class="note">${esc(seriesLabel)} predictions are a fast-follow — Cup ships first. <a href="/predictions">Cup predictions →</a></p>`,
  );
}

export function methodologyContent(backtest: {
  evalSeason: number;
  winBrier: string;
  top10Brier: string;
  calibrationNote: string;
}): string {
  const model = `<p class="note">Each driver gets a <b>rating in finish-position units</b> built only from
races <i>before</i> the target race: trailing-5 average finish, average finish at this track type,
recent loop-data Driver Rating, DNF rate, and the starting position once qualifying has run.
We then simulate the race 5,000 times — every run draws a score around each rating with a
track-type-calibrated spread (superspeedways are near-lotteries; road courses follow form) and
sorts the field. <b>The published probabilities are simply the simulation frequencies.</b></p>
<p class="note">Thursday runs use form only; Saturday runs add the qualifying grid; the Saturday
run is the last word before the green flag. After the race, the page shows what the model said
next to what happened.</p>`;
  const honesty = `<p class="note">The model only ships because it clears the spec's honesty bar on a
held-out ${backtest.evalSeason} season it never trained on: it beats both a uniform baseline and a
trailing-5-average-finish baseline by Brier score (win ${esc(backtest.winBrier)}; top-10
${esc(backtest.top10Brier)}). ${esc(backtest.calibrationNote)}</p>
<p class="note">Entry lists are inferred from the last three completed races (Cup regulars), so a
one-off entry can be missed until qualifying. Predictions are information, not gambling advice —
we take no bets and republish no sportsbook odds.</p>`;
  return `${card("How predictions work", model)}${card("The honesty bar", honesty)}`;
}

// Pure view-model for the predictions screen. Formatting mirrors the web
// page (src/app/pages/predictions.ts) except for the win column: the web
// rounds every probability to a whole percent, which prints "0%" for most of
// a 38-car field. On a phone, where the table is the whole screen, win odds
// carry a decimal so the back half of the field is still readable.
import type { PredictionRow, PredictionsData, PredictionStage } from "./api.ts";

export function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function winPct(value: number | null): string {
  if (value === null) return "—";
  const percent = value * 100;
  return percent >= 10 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;
}

export function fmt(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function stageLabel(stage: PredictionStage | null): string {
  if (stage === "saturday") return "post-qualifying (Saturday)";
  if (stage === "thursday") return "form-based (Thursday)";
  return "unstaged";
}

/** "Sep 8, 2026, 12:00 UTC" — the generation stamp, in UTC like the web. */
export function stamp(generatedAt: string | null): string {
  if (!generatedAt) return "—";
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toUTCString();
}

export function title(data: PredictionsData): string {
  if (!data.race) return "Predictions";
  return data.race.hasResults
    ? `${data.race.raceName} — predicted vs actual`
    : `${data.race.raceName} — predictions`;
}

export function provenance(data: PredictionsData): string {
  return [
    `Generated ${stamp(data.generatedAt)}`,
    stageLabel(data.stage),
    `built from data through race ${data.basisRaceId ?? "?"}`,
  ].join(" · ");
}

export interface PredictionDisplayRow {
  key: string;
  rank: number;
  name: string;
  win: string;
  top5: string;
  top10: string;
  exp: string;
  /** "P3" once the race is scored, "" before that. */
  actual: string;
  /** The model had this driver at or better than where they finished. */
  beat: boolean;
}

export function displayRows(data: PredictionsData): PredictionDisplayRow[] {
  return data.rows.map((row, index) => ({
    key: String(row.driverId),
    rank: index + 1,
    name: row.fullName,
    win: winPct(row.pWin),
    top5: pct(row.pTop5),
    top10: pct(row.pTop10),
    exp: fmt(row.expFinish),
    actual: row.actualFinish === null ? "" : `P${row.actualFinish}`,
    beat: row.actualFinish !== null && row.actualFinish <= Math.round(row.expFinish),
  }));
}

/** The lock line under a free viewer's three rows, or null when unlocked. */
export function withheldLabel(data: PredictionsData): string | null {
  if (data.viewerPro || data.hiddenCount <= 0) return null;
  return `${data.hiddenCount} more ${data.hiddenCount === 1 ? "driver" : "drivers"} with Pro`;
}

/** True when the server has no stored run — the off-season / pre-Thursday state. */
export function isEmpty(data: PredictionsData): boolean {
  return data.race === null || data.rows.length === 0;
}

/** One row per driver's expected fantasy-shaped output, for the detail sheet. */
export function expectationLine(row: PredictionRow): string {
  return [
    row.startPos === null ? "no grid yet" : `starts ${row.startPos}`,
    `${fmt(row.expLapsLed, 0)} laps led`,
    `${fmt(row.expFastLaps, 0)} fast laps`,
  ].join(" · ");
}

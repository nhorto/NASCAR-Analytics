// Pure view-models for the deep tools.
//
// The season-range aggregation mirrors src/app/client/compare.js exactly, and
// for the same documented reason: counting stats sum, average finish/start
// weight by `races`, and loop metrics weight by `loopRaces`. Weighting a loop
// metric by `races` would let a season that had no loop data at all drag the
// driver's rating toward zero.
import type { SeasonStatsRow } from "../drivers/api.ts";
import type { TrackLeaderRow } from "./api.ts";

export function fmt(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

/** Signed format for residual metrics: +4.0 / −1.2 (matching the web). */
export function signed(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text.replace("-", "−");
}

export function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export interface CompareStats {
  races: number;
  wins: number;
  top5s: number;
  top10s: number;
  lapsLed: number;
  points: number;
  avgFinish: number | null;
  avgStart: number | null;
  avgRating: number | null;
  adjPE: number | null;
  closer: number | null;
  top15: number | null;
}

/** Fold a driver's seasons in [from, to] into one comparable row. */
export function aggregateSeasons(
  seasons: readonly SeasonStatsRow[],
  from: number,
  to: number,
): CompareStats | null {
  const rows = seasons.filter((row) => row.season >= from && row.season <= to);
  if (rows.length === 0) return null;
  let races = 0, wins = 0, top5s = 0, top10s = 0, lapsLed = 0, points = 0;
  let finSum = 0, finW = 0, startSum = 0, startW = 0;
  let ratSum = 0, adjSum = 0, closSum = 0, t15Sum = 0, loopW = 0;
  for (const row of rows) {
    races += row.races;
    wins += row.wins;
    top5s += row.top5s;
    top10s += row.top10s;
    lapsLed += row.lapsLed;
    points += row.points;
    if (row.avgFinish !== null) {
      finSum += row.avgFinish * row.races;
      finW += row.races;
    }
    if (row.avgStart !== null) {
      startSum += row.avgStart * row.races;
      startW += row.races;
    }
    if (row.loopRaces > 0) {
      if (row.avgRating !== null) ratSum += row.avgRating * row.loopRaces;
      if (row.adjPassEfficiency !== null) adjSum += row.adjPassEfficiency * row.loopRaces;
      if (row.closerScore !== null) closSum += row.closerScore * row.loopRaces;
      if (row.top15LapPct !== null) t15Sum += row.top15LapPct * row.loopRaces;
      loopW += row.loopRaces;
    }
  }
  return {
    races,
    wins,
    top5s,
    top10s,
    lapsLed,
    points,
    avgFinish: finW > 0 ? finSum / finW : null,
    avgStart: startW > 0 ? startSum / startW : null,
    avgRating: loopW > 0 ? ratSum / loopW : null,
    adjPE: loopW > 0 ? adjSum / loopW : null,
    closer: loopW > 0 ? closSum / loopW : null,
    top15: loopW > 0 ? t15Sum / loopW : null,
  };
}

interface CompareMetric {
  label: string;
  get: (stats: CompareStats) => number | null;
  display: (stats: CompareStats) => string;
  /** Lower is better (finishing and starting positions). */
  low?: boolean;
}

export const COMPARE_METRICS: readonly CompareMetric[] = [
  { label: "Avg Finish", get: (s) => s.avgFinish, display: (s) => fmt(s.avgFinish), low: true },
  { label: "Avg Start", get: (s) => s.avgStart, display: (s) => fmt(s.avgStart), low: true },
  { label: "Rating", get: (s) => s.avgRating, display: (s) => fmt(s.avgRating) },
  { label: "Adj Pass Eff", get: (s) => s.adjPE, display: (s) => signed(s.adjPE) },
  { label: "Closer", get: (s) => s.closer, display: (s) => signed(s.closer, 2) },
  { label: "Top-15 Laps", get: (s) => s.top15, display: (s) => pct(s.top15) },
  { label: "Laps Led", get: (s) => s.lapsLed, display: (s) => String(s.lapsLed) },
  { label: "Wins", get: (s) => s.wins, display: (s) => String(s.wins) },
  { label: "Points", get: (s) => s.points, display: (s) => String(s.points) },
];

export interface ComparePick {
  key: string;
  name: string;
  stats: CompareStats;
}

export interface CompareCell {
  text: string;
  best: boolean;
}

export interface CompareTableRow {
  label: string;
  cells: CompareCell[];
}

/**
 * One row per metric, one cell per driver, with the best value flagged. Two
 * drivers and four drivers use the same layout here: on a phone a
 * driver-per-column table stays readable where the web's mirrored bars do not.
 */
export function compareTable(picks: readonly ComparePick[]): CompareTableRow[] {
  return COMPARE_METRICS.map((metric) => {
    const values = picks.map((pick) => metric.get(pick.stats));
    let best: number | null = null;
    for (const value of values) {
      if (value === null) continue;
      best = best === null ? value : metric.low ? Math.min(best, value) : Math.max(best, value);
    }
    return {
      label: metric.label,
      cells: picks.map((pick, index) => ({
        text: metric.display(pick.stats),
        // A single driver has nothing to win against.
        best: picks.length > 1 && best !== null && values[index] === best,
      })),
    };
  });
}

export type TrackSortKey = "avgFinish" | "avgRating" | "adjPassEfficiency" | "closerScore";

export const TRACK_SORTS: ReadonlyArray<{ value: TrackSortKey; label: string }> = [
  { value: "avgFinish", label: "Avg Fin" },
  { value: "avgRating", label: "Rating" },
  { value: "adjPassEfficiency", label: "Adj PE" },
  { value: "closerScore", label: "Closer" },
];

/**
 * Re-sort the board client-side. The endpoint always orders by average
 * finish; nulls sort last on every key, because "no loop data" is not a score.
 */
export function sortTrackLeaders(
  rows: readonly TrackLeaderRow[],
  key: TrackSortKey,
): TrackLeaderRow[] {
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return key === "avgFinish" ? va - vb : vb - va;
  });
}

export function trackMetricText(row: TrackLeaderRow, key: TrackSortKey): string {
  if (key === "avgFinish") return fmt(row.avgFinish);
  if (key === "avgRating") return fmt(row.avgRating);
  if (key === "adjPassEfficiency") return signed(row.adjPassEfficiency);
  return signed(row.closerScore, 2);
}

/**
 * Keep a season range coherent when one end is dragged past the other —
 * moving `from` above `to` pulls `to` along, matching the web explorer.
 */
export function coerceRange(
  range: { from: number; to: number },
  changed: "from" | "to",
): { from: number; to: number } {
  if (range.to >= range.from) return range;
  return changed === "from" ? { from: range.from, to: range.from } : { from: range.to, to: range.to };
}

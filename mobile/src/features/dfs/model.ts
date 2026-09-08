// Pure view-model for the DFS screen, including the lineup scratchpad.
//
// Why a scratchpad and not an optimizer: an optimizer needs salaries, and the
// product has none — the web page says as much ("paste salaries into your own
// sheet for value; salary import lands post-launch"), and the WS-J plan lists
// a lineup optimizer as out of scope for v1. What a phone at the track can do
// that a printed cheat sheet cannot is keep a running projected total as you
// tap drivers, so that is exactly what this does. Roster sizes are also not
// asserted, because DK and FD classic sizes are not in config/dfs/*.json and
// inventing them here would be the same mistake as hard-coding scoring rules.
import type { DfsData, DfsRow, DfsScoring } from "./api.ts";

export function fmt(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

/** Drop a rule worth nothing on this platform rather than printing "0 pts". */
export function scoringLine(scoring: DfsScoring | null): string | null {
  if (!scoring) return null;
  const parts = [
    scoring.winPoints === null ? null : `${scoring.winPoints} for the win`,
    scoring.lapLedPoints ? `${scoring.lapLedPoints} / lap led` : null,
    scoring.fastLapPoints ? `${scoring.fastLapPoints} / fast lap` : null,
    scoring.placeDiffPoints ? `${scoring.placeDiffPoints} / place gained` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function stampLine(data: DfsData): string {
  const stage = data.stage === "saturday" ? "post-qualifying run" : "form-based run";
  const when = data.generatedAt ? new Date(data.generatedAt) : null;
  const generated = when && !Number.isNaN(when.getTime()) ? when.toUTCString() : "—";
  return [data.race?.raceName, stage, `generated ${generated}`]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** Add or remove a driver, preserving pick order (tap twice to undo). */
export function toggleDriver(selected: readonly number[], driverId: number): number[] {
  return selected.includes(driverId)
    ? selected.filter((id) => id !== driverId)
    : [...selected, driverId];
}

export interface LineupSummary {
  count: number;
  /** Total projected points, rounded to a tenth to avoid float noise. */
  points: number;
  drivers: DfsRow[];
}

export function lineupSummary(rows: readonly DfsRow[], selected: readonly number[]): LineupSummary {
  const byId = new Map(rows.map((row) => [row.driverId, row]));
  const drivers = selected.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  const total = drivers.reduce((sum, row) => sum + row.projectedPoints, 0);
  return { count: drivers.length, points: Math.round(total * 10) / 10, drivers };
}

export interface DfsDisplayRow {
  key: string;
  rank: number;
  driverId: number;
  name: string;
  start: string;
  points: string;
  picked: boolean;
}

export function displayRows(
  rows: readonly DfsRow[],
  selected: readonly number[],
): DfsDisplayRow[] {
  const picked = new Set(selected);
  return rows.map((row, index) => ({
    key: String(row.driverId),
    rank: index + 1,
    driverId: row.driverId,
    name: row.fullName,
    start: row.projectedStart === null ? "—" : String(Math.round(row.projectedStart)),
    points: fmt(row.projectedPoints),
    picked: picked.has(row.driverId),
  }));
}

/** Selections referring to drivers no longer in the run (a new race week). */
export function pruneSelection(
  rows: readonly DfsRow[],
  selected: readonly number[],
): number[] {
  const live = new Set(rows.map((row) => row.driverId));
  return selected.filter((id) => live.has(id));
}

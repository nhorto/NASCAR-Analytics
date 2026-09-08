// Race predictions from GET /api/predictions (WS-F model, WS-J JSON view).
// The server applies the teaser rule before serializing: a free viewer's
// response contains three real rows and a count of what was withheld, so this
// client has nothing to hide and nothing to blur over.
import { timedFetch } from "../../lib/http.ts";

export type PredictionStage = "thursday" | "saturday";

export interface PredictionRow {
  driverId: number;
  fullName: string;
  startPos: number | null;
  pWin: number;
  pTop5: number;
  pTop10: number;
  expFinish: number;
  expLapsLed: number;
  expFastLaps: number;
  /** Set once the race has been run; null before that and for non-starters. */
  actualFinish: number | null;
}

export interface PredictionRace {
  raceId: number;
  raceName: string;
  season: number;
  trackType: string;
  hasResults: boolean;
}

/** The held-out backtest headline, served with the run so it cannot go stale. */
export interface Methodology {
  evalSeason: number;
  winBrier: string;
  top10Brier: string;
  calibrationNote: string;
}

export interface PredictionsData {
  race: PredictionRace | null;
  stage: PredictionStage | null;
  generatedAt: string | null;
  basisRaceId: number | null;
  viewerPro: boolean;
  /** Rows the server withheld because the viewer is not Pro. */
  hiddenCount: number;
  rows: PredictionRow[];
  methodology: Methodology | null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function parseRace(value: unknown): PredictionRace | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.raceId !== "number" || typeof v.raceName !== "string") return null;
  return {
    raceId: v.raceId,
    raceName: v.raceName,
    season: num(v.season),
    trackType: str(v.trackType) ?? "unknown",
    hasResults: v.hasResults === true,
  };
}

function parseMethodology(value: unknown): Methodology | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.evalSeason !== "number") return null;
  return {
    evalSeason: v.evalSeason,
    winBrier: str(v.winBrier) ?? "",
    top10Brier: str(v.top10Brier) ?? "",
    calibrationNote: str(v.calibrationNote) ?? "",
  };
}

export function parsePredictions(value: unknown): PredictionsData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  // The gate bodies (`{error: "pro_required"}`, `{error: "cup_only"}`) have no
  // rows array; treat them as "not usable" rather than as an empty run.
  if (!Array.isArray(v.rows)) return null;
  const rows = v.rows.flatMap((raw): PredictionRow[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.driverId !== "number" || typeof r.fullName !== "string") return [];
    return [
      {
        driverId: r.driverId,
        fullName: r.fullName,
        startPos: numOrNull(r.startPos),
        pWin: num(r.pWin),
        pTop5: num(r.pTop5),
        pTop10: num(r.pTop10),
        expFinish: num(r.expFinish),
        expLapsLed: num(r.expLapsLed),
        expFastLaps: num(r.expFastLaps),
        actualFinish: numOrNull(r.actualFinish),
      },
    ];
  });
  return {
    race: parseRace(v.race),
    stage: v.stage === "saturday" || v.stage === "thursday" ? v.stage : null,
    generatedAt: str(v.generatedAt),
    basisRaceId: numOrNull(v.basisRaceId),
    viewerPro: v.viewerPro === true,
    hiddenCount: num(v.hiddenCount),
    rows,
    methodology: parseMethodology(v.methodology),
  };
}

export async function fetchPredictions(base: string): Promise<PredictionsData | null> {
  try {
    const res = await timedFetch(`${base}/api/predictions`, { credentials: "include" });
    if (!res.ok) return null;
    return parsePredictions(await res.json());
  } catch {
    return null;
  }
}

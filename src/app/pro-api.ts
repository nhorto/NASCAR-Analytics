// GET /api/predictions and GET /api/dfs — the JSON views of the WS-F Pro
// content, added for the native app (WS-J) for the same reason `/api/me` was:
// the predictions table and the DFS projections existed only as rendered HTML,
// and a React Native client cannot scrape a page. These are *views of the same
// service reads* `src/app/pages/{predictions,dfs}.ts` render, with the same
// gating verdicts — not a second product surface.
//
// The gating rules are copied from the pages on purpose:
//   - predictions: free viewers get the top three rows and a count of what is
//     withheld. The hidden rows are never serialized, exactly as the web
//     teaser never renders them.
//   - dfs: Pro-only in full (`featureEnabled("dfs")`), so a non-Pro viewer gets
//     the same 403 body the CSV exports use and the client renders its lock.
//   - Cup only at launch (D16); the series gate in gate.ts has already refused
//     a non-Pro request for another series before this handler is reached.
import { readFileSync } from "node:fs";
import type { Providers } from "../providers/index.ts";
import { predictionsService, type ScoringRules } from "../domains/predictions/index.ts";
import { featureEnabled, PRO_REQUIRED_BODY } from "./gate.ts";
import { METHODOLOGY_BACKTEST } from "./pages/predictions.ts";
import type { Viewer } from "./viewer.ts";

type P = Pick<Providers, "db">;

/** Rows a free viewer may see before the lock (matches pages/predictions.ts). */
const FREE_PREDICTION_ROWS = 3;

const CUP = 1;

const DFS_CONFIG_URLS: Record<string, URL> = {
  dk: new URL("../../config/dfs/dk.json", import.meta.url),
  fd: new URL("../../config/dfs/fd.json", import.meta.url),
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Read once per platform and cached. Synchronous so the router stays
// synchronous: these are two small files that never change while the process
// runs, and a broken one degrades to `scoring: null` rather than failing the
// request (same posture as `loadScoringRules` in predict.ts).
const rulesCache = new Map<string, ScoringRules | null>();

function scoringRules(platform: string): ScoringRules | null {
  const cached = rulesCache.get(platform);
  if (cached !== undefined) return cached;
  const url = DFS_CONFIG_URLS[platform];
  let rules: ScoringRules | null = null;
  if (url) {
    try {
      rules = predictionsService.parseScoringRules(JSON.parse(readFileSync(url, "utf8")), url.pathname);
    } catch {
      rules = null;
    }
  }
  rulesCache.set(platform, rules);
  return rules;
}

/**
 * The scoring facts a client needs to explain a projection honestly, taken
 * from config/dfs/*.json so the app never hard-codes a platform's rules.
 * `winPoints` is the head of the finish table — the one number worth showing
 * without shipping all forty.
 */
function scoringSummary(rules: ScoringRules | null) {
  if (!rules) return null;
  return {
    platform: rules.platform,
    winPoints: rules.finishPoints[0] ?? null,
    lapLedPoints: rules.lapLedPoints,
    fastLapPoints: rules.fastLapPoints,
    placeDiffPoints: rules.placeDiffPoints,
  };
}

function seriesOf(url: URL): number {
  const s = Number.parseInt(url.searchParams.get("series") ?? "", 10);
  return s === 2 || s === 3 ? s : CUP;
}

function predictions(p: P, url: URL, viewer: Viewer): Response {
  if (seriesOf(url) !== CUP) return json({ error: "cup_only" }, 404);
  const raceId = predictionsService.latestPredictedRaceId(p, CUP);
  const latest = raceId === null ? null : predictionsService.latestPredictions(p, raceId);
  const race = raceId === null ? null : predictionsService.raceInfo(p, raceId);
  const methodology = { ...METHODOLOGY_BACKTEST };
  if (!latest || !race || latest.rows.length === 0)
    return json({ race: null, rows: [], hiddenCount: 0, viewerPro: viewer.pro, methodology });

  const hasResults = Boolean(race.hasResults);
  const actual = hasResults ? predictionsService.actualFinishes(p, race.raceId) : null;
  const visible = viewer.pro ? latest.rows : latest.rows.slice(0, FREE_PREDICTION_ROWS);
  return json({
    race: {
      raceId: race.raceId,
      raceName: race.raceName,
      season: race.season,
      trackType: race.trackType,
      hasResults,
    },
    stage: latest.stage,
    generatedAt: latest.rows[0]!.generatedAt,
    basisRaceId: latest.rows[0]!.basisRaceId,
    viewerPro: viewer.pro,
    hiddenCount: latest.rows.length - visible.length,
    rows: visible.map((r) => ({
      driverId: r.driverId,
      fullName: r.fullName,
      startPos: r.startPos,
      pWin: r.pWin,
      pTop5: r.pTop5,
      pTop10: r.pTop10,
      expFinish: r.expFinish,
      expLapsLed: r.expLapsLed,
      expFastLaps: r.expFastLaps,
      actualFinish: actual?.get(r.driverId)?.finish ?? null,
    })),
    methodology,
  });
}

function dfs(p: P, url: URL, viewer: Viewer): Response {
  if (!featureEnabled("dfs", viewer)) return json(PRO_REQUIRED_BODY, 403);
  if (seriesOf(url) !== CUP) return json({ error: "cup_only" }, 404);
  const platform = url.searchParams.get("scoring") === "fd" ? "fd" : "dk";
  const scoring = scoringSummary(scoringRules(platform));
  const raceId = predictionsService.latestPredictedRaceId(p, CUP);
  const rows = raceId === null ? [] : predictionsService.latestProjections(p, raceId, platform);
  const race = raceId === null ? null : predictionsService.raceInfo(p, raceId);
  if (rows.length === 0 || !race) return json({ race: null, platform, scoring, rows: [] });
  return json({
    race: { raceId: race.raceId, raceName: race.raceName, season: race.season },
    platform,
    scoring,
    stage: rows[0]!.stage,
    generatedAt: rows[0]!.generatedAt,
    rows: rows.map((r) => ({
      driverId: r.driverId,
      fullName: r.fullName,
      projectedStart: r.projectedStart,
      projectedPoints: r.projectedPoints,
    })),
  });
}

/** Handles the two Pro JSON views; null for every other path. */
export function handleProApiRequest(
  p: P,
  method: string,
  url: URL,
  viewer: Viewer,
): Response | null {
  if (url.pathname !== "/api/predictions" && url.pathname !== "/api/dfs") return null;
  if (method !== "GET") return json({ error: "method_not_allowed" }, 405);
  return url.pathname === "/api/predictions" ? predictions(p, url, viewer) : dfs(p, url, viewer);
}

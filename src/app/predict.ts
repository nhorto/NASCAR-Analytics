// `bun run predict` composition (WS-F): resolve the target race, load the DFS
// scoring configs (config/dfs/*.json — rules are configuration, not code),
// fetch qualifying from the CDN weekend feed for upcoming races on saturday
// runs, then run the predictions service and print the table.
import type { Providers } from "../providers/index.ts";
import { predictionsService, type PredictionStage, type ScoringRules } from "../domains/predictions/index.ts";
import { ingestionConfig } from "../domains/data-ingestion/index.ts";

export interface PredictLog {
  info: (m: string) => void;
  warn: (m: string) => void;
}

const DFS_CONFIG_URLS = [
  new URL("../../config/dfs/dk.json", import.meta.url),
  new URL("../../config/dfs/fd.json", import.meta.url),
];

export async function loadScoringRules(log: PredictLog): Promise<ScoringRules[]> {
  const rules: ScoringRules[] = [];
  for (const url of DFS_CONFIG_URLS) {
    try {
      const raw = await Bun.file(url).json();
      rules.push(predictionsService.parseScoringRules(raw, url.pathname));
    } catch (err) {
      // A broken scoring config must not block predictions themselves.
      log.warn(`skipping DFS config ${url.pathname}: ${String(err)}`);
    }
  }
  return rules;
}

/** Qualifying grid for an upcoming race from the CDN weekend feed (the race
 *  isn't ingested yet — results only exist post-race). Null when quals
 *  haven't run or the feed is unavailable. */
export async function upcomingQualifying(
  p: Pick<Providers, "cdn">,
  race: { raceId: number; seriesId: number; season: number },
): Promise<Map<number, number> | null> {
  const res = await p.cdn.fetchJson(
    ingestionConfig.weekendFeedUrl(race.season, race.seriesId, race.raceId),
  );
  const weekend = (res.json as { weekend_race?: Array<{ results?: unknown[] }> } | null)
    ?.weekend_race?.[0];
  if (!weekend?.results?.length) return null;
  const grid = new Map<number, number>();
  for (const entry of weekend.results as Array<Record<string, unknown>>) {
    const driverId = Number(entry.driver_id);
    const start = Number(entry.starting_position) || Number(entry.qualifying_position);
    if (Number.isFinite(driverId) && driverId > 0 && Number.isFinite(start) && start > 0)
      grid.set(driverId, start);
  }
  return grid.size > 0 ? grid : null;
}

export interface PredictOptions {
  raceId?: number;
  stage?: PredictionStage;
  seriesId?: number;
  now?: Date;
  log: PredictLog;
}

export async function runPredict(p: Providers, opts: PredictOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const seriesId = opts.seriesId ?? 1;
  const race =
    opts.raceId !== undefined
      ? predictionsService.raceInfo(p, opts.raceId)
      : predictionsService.nextRaceWithoutResults(p, seriesId, now.toISOString());
  if (!race) {
    throw new Error(
      opts.raceId !== undefined
        ? `Race ${opts.raceId} not found`
        : `No upcoming race without results for series ${seriesId} — pass --race ID`,
    );
  }

  const stage = opts.stage ?? "thursday";
  let startPositions: Map<number, number> | undefined;
  if (stage === "saturday") {
    startPositions = race.hasResults
      ? predictionsService.startingPositions(p, race.raceId)
      : ((await upcomingQualifying(p, race)) ?? undefined);
    if (!startPositions || startPositions.size === 0) {
      opts.log.warn("no qualifying data available — running with form-only weights");
      startPositions = undefined;
    }
  }

  const scoringRules = await loadScoringRules(opts.log);
  const { run, projections } = predictionsService.generatePredictions(p, {
    raceId: race.raceId,
    stage,
    startPositions,
    now,
    scoringRules,
  });

  opts.log.info(
    `${race.raceName} (${race.season}, ${race.trackType}) — ${stage} run, ` +
      `${run.predictions.length} drivers, basis race ${run.basisRaceId ?? "?"}`,
  );
  for (const pred of run.predictions.slice(0, 12)) {
    opts.log.info(
      `  ${pred.fullName.padEnd(24)} win ${(pred.pWin * 100).toFixed(1).padStart(5)}%  ` +
        `top5 ${(pred.pTop5 * 100).toFixed(0).padStart(3)}%  top10 ${(pred.pTop10 * 100).toFixed(0).padStart(3)}%  ` +
        `exp ${pred.expFinish.toFixed(1)}`,
    );
  }
  const platforms = [...new Set(projections.map((row) => row.platform))].join(", ");
  opts.log.info(`stored predictions + DFS projections (${platforms || "no scoring configs"})`);
}

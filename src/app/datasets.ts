// The CSV export registry (WS-G): one entry per table the site renders, so
// "export on every table" stays true as pages are added — a new table is a new
// entry here plus the link on its page. Each dataset declares its column
// header (a stable public contract), builds rows from the same services the
// page uses, and names its own file from the filters in play.
import type { Providers } from "../providers/index.ts";
import { analyticsService } from "../domains/analytics/index.ts";
import { driversService } from "../domains/drivers/index.ts";
import { ingestionService } from "../domains/data-ingestion/index.ts";
import { predictionsService } from "../domains/predictions/index.ts";
import type { SeasonStanding } from "../domains/analytics/index.ts";
import { csvFilename } from "./csv.ts";

type P = Pick<Providers, "db">;

const SERIES_SLUG: Record<number, string> = { 1: "cup", 2: "xfinity", 3: "trucks" };

export interface DatasetParams {
  seriesId: number;
  season: number | null;
  raceId: number | null;
  driverId: number | null;
  trackType: string;
  fromSeason: number | null;
  toSeason: number | null;
  minStarts: number;
  platform: string;
  /** Explicit driver selection (compare exports). */
  driverIds: number[];
  /** `?series=1,2` — compare can span series for a Pro viewer. */
  seriesIds: number[];
}

export interface Dataset {
  id: string;
  label: string;
  columns: readonly string[];
  /** Null when the requested subject doesn't exist → the route answers 404. */
  build(p: P, params: DatasetParams): { filename: string; rows: unknown[][] } | null;
}

function intParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Parse the query string into typed params; unknown/malformed values fall back. */
export function parseDatasetParams(url: URL, seriesId: number): DatasetParams {
  const q = url.searchParams;
  return {
    seriesId,
    season: intParam(q.get("season")),
    raceId: intParam(q.get("race")),
    driverId: intParam(q.get("driver")),
    trackType: q.get("type") ?? "road",
    fromSeason: intParam(q.get("from")),
    toSeason: intParam(q.get("to")),
    minStarts: intParam(q.get("min")) ?? 1,
    platform: q.get("scoring") === "fd" ? "fd" : "dk",
    driverIds: idList(q.get("drivers")),
    seriesIds: idList(q.get("series")).length > 0 ? idList(q.get("series")) : [seriesId],
  };
}

/** Comma-separated positive ints; anything unparseable drops out. */
function idList(raw: string | null): number[] {
  return (raw ?? "")
    .split(",")
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function slug(seriesId: number): string {
  return SERIES_SLUG[seriesId] ?? String(seriesId);
}

/** The season a dataset should use when the request didn't name one. */
function seasonOf(p: P, params: DatasetParams): number | null {
  return params.season ?? analyticsService.currentSeason(p, params.seriesId);
}

const SEASON_STAT_COLUMNS = [
  "driver_id", "driver", "season", "races", "wins", "top5s", "top10s", "dnfs",
  "avg_start", "avg_finish", "laps_led", "points", "playoff_points", "loop_races",
  "avg_rating", "top15_lap_pct", "fast_lap_pct", "pass_efficiency",
  "adj_pass_efficiency", "avg_closing_gain", "closer_score",
] as const;

function seasonStatRow(s: SeasonStanding): unknown[] {
  return [
    s.driverId, s.fullName, s.season, s.races, s.wins, s.top5s, s.top10s, s.dnfs,
    s.avgStart, s.avgFinish, s.lapsLed, s.points, s.playoffPoints, s.loopRaces,
    s.avgRating, s.top15LapPct, s.fastLapPct, s.passEfficiency,
    s.adjPassEfficiency, s.avgClosingGain, s.closerScore,
  ];
}

const standings: Dataset = {
  id: "standings",
  label: "Standings",
  columns: ["rank", ...SEASON_STAT_COLUMNS],
  build(p, params) {
    const season = seasonOf(p, params);
    if (season === null) return null;
    const rows = analyticsService
      .standings(p, season, params.seriesId)
      .map((s, i) => [i + 1, ...seasonStatRow(s)]);
    return { filename: csvFilename(["looplab", slug(params.seriesId), "standings", season]), rows };
  },
};

const seasonStats: Dataset = {
  id: "season-stats",
  label: "All season stats",
  columns: SEASON_STAT_COLUMNS,
  build(p, params) {
    const from = params.fromSeason;
    const to = params.toSeason;
    const rows = analyticsService
      .allSeasonStats(p, params.seriesId)
      .filter((s) => (from === null || s.season >= from) && (to === null || s.season <= to))
      .map(seasonStatRow);
    return {
      filename: csvFilename(["looplab", slug(params.seriesId), "season-stats", from, to]),
      rows,
    };
  },
};

const compare: Dataset = {
  id: "compare",
  label: "Comparison",
  // Compare is the one export that can span series, so it carries the series id.
  columns: ["series_id", ...SEASON_STAT_COLUMNS],
  build(p, params) {
    if (params.driverIds.length === 0) return null;
    const wanted = new Set(params.driverIds);
    const from = params.fromSeason;
    const to = params.toSeason;
    const rows: unknown[][] = [];
    for (const seriesId of params.seriesIds) {
      for (const s of analyticsService.allSeasonStats(p, seriesId)) {
        if (!wanted.has(s.driverId)) continue;
        if (from !== null && s.season < from) continue;
        if (to !== null && s.season > to) continue;
        rows.push([seriesId, ...seasonStatRow(s)]);
      }
    }
    return {
      filename: csvFilename([
        "looplab",
        params.seriesIds.map(slug).join("-"),
        "compare",
        from,
        to,
      ]),
      rows,
    };
  },
};

const driversIndex: Dataset = {
  id: "drivers",
  label: "Drivers",
  columns: [
    "driver_id", "driver", "first_season", "last_season", "races", "wins",
    "latest_team", "latest_car_number", "latest_car_make",
  ],
  build(p, params) {
    const rows = driversService.driverIndex(p, params.seriesId).map((d) => [
      d.driverId, d.fullName, d.firstSeason, d.lastSeason, d.races, d.wins,
      d.latestTeam, d.latestCarNumber, d.latestCarMake,
    ]);
    return { filename: csvFilename(["looplab", slug(params.seriesId), "drivers"]), rows };
  },
};

const driverLog: Dataset = {
  id: "driver-log",
  label: "Race log",
  columns: [
    "race_id", "season", "race_date_utc", "race", "track_type", "start", "finish",
    "status", "laps_led", "points", "rating", "disqualified",
  ],
  build(p, params) {
    if (params.driverId === null) return null;
    const driver = driversService.findDriver(p, params.driverId, params.seriesId);
    if (!driver) return null;
    const rows = driversService.driverRaceLog(p, params.driverId, params.seriesId).map((r) => [
      r.raceId, r.season, r.raceDateUtc, r.raceName, r.trackType, r.start, r.finish,
      r.status, r.lapsLed, r.points, r.rating, r.disqualified,
    ]);
    return {
      filename: csvFilename(["looplab", slug(params.seriesId), "race-log", driver.fullName]),
      rows,
    };
  },
};

const career: Dataset = {
  id: "career",
  label: "Career",
  columns: ["series_id", "season", "races", "wins", "top5s", "top10s", "avg_finish"],
  build(p, params) {
    if (params.driverId === null) return null;
    const c = driversService.driverCareer(p, params.driverId);
    if (!c) return null;
    const rows = c.seasons.map((s) => [
      s.seriesId, s.season, s.races, s.wins, s.top5s, s.top10s, s.avgFinish,
    ]);
    return { filename: csvFilename(["looplab", "career", c.fullName]), rows };
  },
};

const races: Dataset = {
  id: "races",
  label: "Races",
  columns: ["race_id", "season", "race", "track_type", "race_date_utc", "has_results", "winner"],
  build(p, params) {
    const season = seasonOf(p, params);
    if (season === null) return null;
    const rows = ingestionService.seasonRaces(p, season, params.seriesId).map((r) => [
      r.raceId, r.season, r.raceName, r.trackType, r.raceDateUtc, r.hasResults, r.winnerName,
    ]);
    return { filename: csvFilename(["looplab", slug(params.seriesId), "races", season]), rows };
  },
};

const raceResults: Dataset = {
  id: "race-results",
  label: "Race results",
  columns: [
    "race_id", "race", "season", "finish", "start", "driver_id", "driver", "car_number",
    "team", "status", "laps_led", "points", "disqualified", "rating", "passes_gf",
    "passed_gf", "fast_laps", "closing_laps_diff",
  ],
  build(p, params) {
    if (params.raceId === null) return null;
    const race = ingestionService.raceDetails(p, params.raceId);
    if (!race) return null;
    const rows = ingestionService.raceResults(p, race.raceId).map((r) => [
      race.raceId, race.raceName, race.season, r.finish, r.start, r.driverId, r.fullName,
      r.carNumber, r.teamName, r.status, r.lapsLed, r.points, r.disqualified, r.rating,
      r.passesGf, r.passedGf, r.fastLaps, r.closingLapsDiff,
    ]);
    return { filename: csvFilename(["looplab", "race", race.season, race.raceName]), rows };
  },
};

const standouts: Dataset = {
  id: "standouts",
  label: "Race standouts",
  columns: ["race_id", "driver_id", "driver", "adj_pass_efficiency", "closer_score"],
  build(p, params) {
    if (params.raceId === null) return null;
    const race = ingestionService.raceDetails(p, params.raceId);
    if (!race) return null;
    const rows = analyticsService.raceStandouts(p, race.raceId).map((s) => [
      race.raceId, s.driverId, s.fullName, s.adjPassEfficiency, s.closerScore,
    ]);
    return { filename: csvFilename(["looplab", "standouts", race.season, race.raceName]), rows };
  },
};

const playoff: Dataset = {
  id: "playoff",
  label: "Playoff picture",
  columns: ["rank", "driver_id", "driver", "wins", "points", "playoff_points", "status", "points_to_cut"],
  build(p, params) {
    if (params.raceId === null) return null;
    const race = ingestionService.raceDetails(p, params.raceId);
    if (!race) return null;
    const picture = analyticsService.playoffPictureFor(p, {
      seriesId: race.seriesId,
      season: race.season,
      raceId: race.raceId,
    });
    const rows = picture.rows.map((r, i) => [
      i + 1, r.driverId, r.fullName, r.wins, r.points, r.playoffPoints, r.status, r.pointsToCut,
    ]);
    return {
      filename: csvFilename(["looplab", slug(race.seriesId), "playoff", race.season, race.raceName]),
      rows,
    };
  },
};

const metrics: Dataset = {
  id: "metrics",
  label: "Metric leaders",
  columns: ["metric", "rank", "driver_id", "driver", "loop_races", "value", "percentile"],
  build(p, params) {
    const season = seasonOf(p, params);
    if (season === null) return null;
    const board = analyticsService.seasonMetricBoard(p, season, params.seriesId);
    const rows = [
      ...board.adjPass.map((m, i) => ["adj_pass_efficiency", i + 1, m.driverId, m.fullName, m.loopRaces, m.value, m.percentile]),
      ...board.closer.map((m, i) => ["closer_score", i + 1, m.driverId, m.fullName, m.loopRaces, m.value, m.percentile]),
    ];
    return { filename: csvFilename(["looplab", slug(params.seriesId), "metrics", season]), rows };
  },
};

const trackTypes: Dataset = {
  id: "track-types",
  label: "Track-type leaders",
  columns: [
    "track_type", "from_season", "to_season", "rank", "driver_id", "driver", "starts",
    "wins", "top5s", "avg_finish", "avg_rating", "adj_pass_efficiency", "closer_score",
  ],
  build(p, params) {
    const latest = analyticsService.currentSeason(p, params.seriesId);
    if (latest === null) return null;
    const to = params.toSeason ?? latest;
    const from = params.fromSeason ?? to - 7;
    const rows = analyticsService
      .trackTypeLeaderboard(p, {
        trackType: params.trackType,
        fromSeason: from,
        toSeason: to,
        minStarts: params.minStarts,
        seriesId: params.seriesId,
      })
      .map((r, i) => [
        params.trackType, from, to, i + 1, r.driverId, r.fullName, r.starts, r.wins,
        r.top5s, r.avgFinish, r.avgRating, r.adjPassEfficiency, r.closerScore,
      ]);
    return {
      filename: csvFilename([
        "looplab", slug(params.seriesId), "track", params.trackType, from, to,
        params.minStarts > 1 ? `min${params.minStarts}` : null,
      ]),
      rows,
    };
  },
};

const predictions: Dataset = {
  id: "predictions",
  label: "Predictions",
  columns: [
    "race_id", "race", "stage", "generated_at", "driver_id", "driver", "start_pos",
    "rating", "p_win", "p_top5", "p_top10", "exp_finish", "exp_laps_led", "exp_fast_laps",
  ],
  build(p, params) {
    const raceId = params.raceId ?? predictionsService.latestPredictedRaceId(p, params.seriesId);
    if (raceId === null) return null;
    const run = predictionsService.latestPredictions(p, raceId);
    const race = predictionsService.raceInfo(p, raceId);
    if (!run || !race) return null;
    const rows = run.rows.map((r) => [
      raceId, race.raceName, r.stage, r.generatedAt, r.driverId, r.fullName, r.startPos,
      r.rating, r.pWin, r.pTop5, r.pTop10, r.expFinish, r.expLapsLed, r.expFastLaps,
    ]);
    return {
      filename: csvFilename(["looplab", "predictions", race.season, race.raceName, run.stage]),
      rows,
    };
  },
};

const dfs: Dataset = {
  id: "dfs",
  label: "DFS projections",
  columns: [
    "race_id", "race", "platform", "stage", "generated_at", "rank", "driver_id",
    "driver", "projected_start", "projected_points",
  ],
  build(p, params) {
    const raceId = params.raceId ?? predictionsService.latestPredictedRaceId(p, params.seriesId);
    if (raceId === null) return null;
    const race = predictionsService.raceInfo(p, raceId);
    const projections = predictionsService.latestProjections(p, raceId, params.platform);
    if (!race || projections.length === 0) return null;
    const rows = projections.map((r, i) => [
      raceId, race.raceName, r.platform, r.stage, r.generatedAt, i + 1, r.driverId,
      r.fullName, r.projectedStart, r.projectedPoints,
    ]);
    return {
      filename: csvFilename(["looplab", "dfs", params.platform, race.season, race.raceName]),
      rows,
    };
  },
};

export const DATASETS: Record<string, Dataset> = Object.fromEntries(
  [
    standings, seasonStats, compare, driversIndex, driverLog, career, races,
    raceResults, standouts, playoff, metrics, trackTypes, predictions, dfs,
  ].map((d) => [d.id, d]),
);

export function datasetFor(id: string): Dataset | null {
  return DATASETS[id] ?? null;
}

import type { Database } from "bun:sqlite";
import type {
  PointsResultRow,
  PointsLoopRow,
  DriverSeasonStats,
  DriverTrackTypeStats,
  DriverFormRow,
  SeasonStanding,
  TrackTypeLeaderRow,
  FormLeader,
  RaceMetricStandout,
  RaceStandout,
  SeasonPointsResultRow,
} from "./types.ts";
import { POINTS_RACE_TYPE_ID, POINTS_RACE_ID_OVERRIDES } from "./config.ts";

const OVERRIDE_PLACEHOLDERS = POINTS_RACE_ID_OVERRIDES.map(() => "?").join(",") || "NULL";
const POINTS_FILTER = `(r.race_type_id = ? OR r.race_id IN (${OVERRIDE_PLACEHOLDERS}))`;

// ---- Source reads (ingestion-owned tables) ----

export function pointsResults(db: Database, seriesId: number): PointsResultRow[] {
  return db
    .query(
      `SELECT res.race_id AS raceId, r.series_id AS seriesId, r.season AS season,
              r.track_type AS trackType,
              COALESCE(r.race_date_utc, r.race_date) AS raceDateUtc,
              res.driver_id AS driverId,
              res.starting_position AS start,
              res.finishing_position AS finish,
              res.finishing_status AS status,
              res.laps_led AS lapsLed,
              res.points_earned AS points,
              res.playoff_points_earned AS playoffPoints
       FROM results res
       JOIN races r ON r.race_id = res.race_id
       WHERE r.series_id = ? AND ${POINTS_FILTER}
       ORDER BY COALESCE(r.race_date_utc, r.race_date), res.race_id`,
    )
    .all(seriesId, POINTS_RACE_TYPE_ID, ...POINTS_RACE_ID_OVERRIDES) as unknown as PointsResultRow[];
}

export function pointsLoopStats(db: Database, seriesId: number): PointsLoopRow[] {
  return db
    .query(
      `SELECT ls.race_id AS raceId, r.series_id AS seriesId, r.season AS season,
              r.track_type AS trackType,
              ls.driver_id AS driverId,
              ls.avg_ps AS avgPs,
              ls.closing_ps AS closingPs,
              ls.closing_laps_diff AS closingLapsDiff,
              ls.passes_gf AS passesGf,
              ls.passed_gf AS passedGf,
              ls.fast_laps AS fastLaps,
              ls.top15_laps AS top15Laps,
              ls.laps AS laps,
              ls.rating AS rating
       FROM loop_stats ls
       JOIN races r ON r.race_id = ls.race_id
       WHERE r.series_id = ? AND ${POINTS_FILTER}
       ORDER BY COALESCE(r.race_date_utc, r.race_date), ls.race_id`,
    )
    .all(seriesId, POINTS_RACE_TYPE_ID, ...POINTS_RACE_ID_OVERRIDES) as unknown as PointsLoopRow[];
}

// ---- Computed-table writes (full replace per series, transactional) ----

export function replaceSeasonStats(
  db: Database,
  seriesId: number,
  rows: DriverSeasonStats[],
): void {
  const stmt = db.query(
    `INSERT INTO driver_season_stats (
       driver_id, series_id, season, races, wins, top5s, top10s, dnfs,
       avg_start, avg_finish, laps_led, points, playoff_points,
       loop_races, avg_rating, top15_lap_pct, fast_lap_pct,
       pass_efficiency, adj_pass_efficiency, avg_closing_gain, closer_score
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    db.query(`DELETE FROM driver_season_stats WHERE series_id = ?`).run(seriesId);
    for (const s of rows) {
      stmt.run(
        s.driverId, s.seriesId, s.season, s.races, s.wins, s.top5s, s.top10s, s.dnfs,
        s.avgStart, s.avgFinish, s.lapsLed, s.points, s.playoffPoints,
        s.loopRaces, s.avgRating, s.top15LapPct, s.fastLapPct,
        s.passEfficiency, s.adjPassEfficiency, s.avgClosingGain, s.closerScore,
      );
    }
  });
  run();
}

export function replaceTrackTypeStats(
  db: Database,
  seriesId: number,
  rows: DriverTrackTypeStats[],
): void {
  const stmt = db.query(
    `INSERT INTO driver_track_type_stats (
       driver_id, series_id, season, track_type, races, wins, top5s, top10s, dnfs,
       avg_start, avg_finish, laps_led, loop_races, avg_rating,
       pass_efficiency, adj_pass_efficiency, avg_closing_gain, closer_score
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    db.query(`DELETE FROM driver_track_type_stats WHERE series_id = ?`).run(seriesId);
    for (const s of rows) {
      stmt.run(
        s.driverId, s.seriesId, s.season, s.trackType, s.races, s.wins, s.top5s, s.top10s,
        s.dnfs, s.avgStart, s.avgFinish, s.lapsLed, s.loopRaces, s.avgRating,
        s.passEfficiency, s.adjPassEfficiency, s.avgClosingGain, s.closerScore,
      );
    }
  });
  run();
}

export function replaceRaceStandouts(
  db: Database,
  seriesId: number,
  rows: RaceMetricStandout[],
): void {
  const stmt = db.query(
    `INSERT INTO race_metric_standouts (
       race_id, series_id, season, driver_id, adj_pass_efficiency, closer_score, rating
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    db.query(`DELETE FROM race_metric_standouts WHERE series_id = ?`).run(seriesId);
    for (const s of rows) {
      stmt.run(
        s.raceId, s.seriesId, s.season, s.driverId,
        s.adjPassEfficiency, s.closerScore, s.rating,
      );
    }
  });
  run();
}

export function replaceForm(db: Database, seriesId: number, rows: DriverFormRow[]): void {
  const stmt = db.query(
    `INSERT INTO driver_form (
       driver_id, series_id, race_id, season, race_date_utc,
       window_races, avg_finish, avg_start, avg_rating, avg_closing_gain
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    db.query(`DELETE FROM driver_form WHERE series_id = ?`).run(seriesId);
    for (const f of rows) {
      stmt.run(
        f.driverId, f.seriesId, f.raceId, f.season, f.raceDateUtc,
        f.windowRaces, f.avgFinish, f.avgStart, f.avgRating, f.avgClosingGain,
      );
    }
  });
  run();
}

// ---- Computed-table reads (consumed by Phase 3 runtime, the CLI, and tests) ----

export function seasonStatsForDriver(
  db: Database,
  driverId: number,
  seriesId: number,
): DriverSeasonStats[] {
  return db
    .query(
      `SELECT driver_id AS driverId, series_id AS seriesId, season, races, wins,
              top5s, top10s, dnfs, avg_start AS avgStart, avg_finish AS avgFinish,
              laps_led AS lapsLed, points, playoff_points AS playoffPoints,
              loop_races AS loopRaces, avg_rating AS avgRating,
              top15_lap_pct AS top15LapPct, fast_lap_pct AS fastLapPct,
              pass_efficiency AS passEfficiency, adj_pass_efficiency AS adjPassEfficiency,
              avg_closing_gain AS avgClosingGain, closer_score AS closerScore
       FROM driver_season_stats
       WHERE driver_id = ? AND series_id = ?
       ORDER BY season`,
    )
    .all(driverId, seriesId) as unknown as DriverSeasonStats[];
}

export function seasonStatsForSeason(
  db: Database,
  season: number,
  seriesId: number,
): DriverSeasonStats[] {
  return db
    .query(
      `SELECT driver_id AS driverId, series_id AS seriesId, season, races, wins,
              top5s, top10s, dnfs, avg_start AS avgStart, avg_finish AS avgFinish,
              laps_led AS lapsLed, points, playoff_points AS playoffPoints,
              loop_races AS loopRaces, avg_rating AS avgRating,
              top15_lap_pct AS top15LapPct, fast_lap_pct AS fastLapPct,
              pass_efficiency AS passEfficiency, adj_pass_efficiency AS adjPassEfficiency,
              avg_closing_gain AS avgClosingGain, closer_score AS closerScore
       FROM driver_season_stats
       WHERE season = ? AND series_id = ?
       ORDER BY wins DESC, avg_finish`,
    )
    .all(season, seriesId) as unknown as DriverSeasonStats[];
}

export function trackTypeStatsForDriver(
  db: Database,
  driverId: number,
  seriesId: number,
): DriverTrackTypeStats[] {
  return db
    .query(
      `SELECT driver_id AS driverId, series_id AS seriesId, season, track_type AS trackType,
              races, wins, top5s, top10s, dnfs, avg_start AS avgStart,
              avg_finish AS avgFinish, laps_led AS lapsLed, loop_races AS loopRaces,
              avg_rating AS avgRating, pass_efficiency AS passEfficiency,
              adj_pass_efficiency AS adjPassEfficiency,
              avg_closing_gain AS avgClosingGain, closer_score AS closerScore
       FROM driver_track_type_stats
       WHERE driver_id = ? AND series_id = ?
       ORDER BY season, track_type`,
    )
    .all(driverId, seriesId) as unknown as DriverTrackTypeStats[];
}

export function standingsForSeason(
  db: Database,
  season: number,
  seriesId: number,
): SeasonStanding[] {
  return db
    .query(
      `SELECT s.driver_id AS driverId, s.series_id AS seriesId, s.season, s.races, s.wins,
              s.top5s, s.top10s, s.dnfs, s.avg_start AS avgStart, s.avg_finish AS avgFinish,
              s.laps_led AS lapsLed, s.points, s.playoff_points AS playoffPoints,
              s.loop_races AS loopRaces, s.avg_rating AS avgRating,
              s.top15_lap_pct AS top15LapPct, s.fast_lap_pct AS fastLapPct,
              s.pass_efficiency AS passEfficiency, s.adj_pass_efficiency AS adjPassEfficiency,
              s.avg_closing_gain AS avgClosingGain, s.closer_score AS closerScore,
              d.full_name AS fullName
       FROM driver_season_stats s
       JOIN drivers d ON d.driver_id = s.driver_id
       WHERE s.season = ? AND s.series_id = ?
       ORDER BY s.points DESC, s.wins DESC, s.avg_finish`,
    )
    .all(season, seriesId) as unknown as SeasonStanding[];
}

export function trackTypeLeaderboard(
  db: Database,
  opts: {
    trackType: string;
    fromSeason: number;
    toSeason: number;
    seriesId: number;
    minStarts: number;
  },
): TrackTypeLeaderRow[] {
  return db
    .query(
      `SELECT t.driver_id AS driverId, d.full_name AS fullName,
              SUM(t.races) AS starts, SUM(t.wins) AS wins, SUM(t.top5s) AS top5s,
              SUM(COALESCE(t.avg_finish, 0) * t.races) / NULLIF(SUM(t.races), 0) AS avgFinish,
              SUM(COALESCE(t.avg_rating, 0) * t.loop_races) / NULLIF(SUM(t.loop_races), 0) AS avgRating,
              SUM(COALESCE(t.adj_pass_efficiency, 0) * t.loop_races) / NULLIF(SUM(t.loop_races), 0) AS adjPassEfficiency,
              SUM(COALESCE(t.closer_score, 0) * t.loop_races) / NULLIF(SUM(t.loop_races), 0) AS closerScore
       FROM driver_track_type_stats t
       JOIN drivers d ON d.driver_id = t.driver_id
       WHERE t.track_type = ? AND t.season BETWEEN ? AND ? AND t.series_id = ?
       GROUP BY t.driver_id
       HAVING SUM(t.races) >= ?
       ORDER BY avgFinish`,
    )
    .all(
      opts.trackType,
      opts.fromSeason,
      opts.toSeason,
      opts.seriesId,
      opts.minStarts,
    ) as unknown as TrackTypeLeaderRow[];
}

/**
 * Form rows at the most recent race with form data, best average finish first —
 * restricted to season regulars (ran >= `minSeasonShare` of the season's points
 * races so far) so a part-timer's few strong starts can't top the board.
 */
export function formLeaders(
  db: Database,
  seriesId: number,
  limit: number,
  minSeasonShare: number,
): FormLeader[] {
  return db
    .query(
      `WITH latest AS (
         SELECT race_id, season FROM driver_form
         WHERE series_id = ? ORDER BY race_date_utc DESC LIMIT 1
       ),
       season_total AS (
         SELECT COUNT(DISTINCT race_id) AS n FROM driver_form
         WHERE series_id = ? AND season = (SELECT season FROM latest)
       )
       SELECT f.driver_id AS driverId, d.full_name AS fullName, f.race_id AS raceId,
              f.window_races AS windowRaces, f.avg_finish AS avgFinish, f.avg_rating AS avgRating
       FROM driver_form f
       JOIN drivers d ON d.driver_id = f.driver_id
       WHERE f.series_id = ?
         AND f.race_id = (SELECT race_id FROM latest)
         AND f.window_races >= 4
         AND (SELECT COUNT(*) FROM driver_form x
              WHERE x.driver_id = f.driver_id AND x.series_id = f.series_id
                AND x.season = f.season)
             >= ? * (SELECT n FROM season_total)
       ORDER BY f.avg_finish
       LIMIT ?`,
    )
    .all(seriesId, seriesId, seriesId, minSeasonShare, limit) as unknown as FormLeader[];
}

/** Every season-stat row for a series, with driver name — powers the client compare page. */
export function allSeasonStatsWithNames(db: Database, seriesId: number): SeasonStanding[] {
  return db
    .query(
      `SELECT s.driver_id AS driverId, s.series_id AS seriesId, s.season, s.races, s.wins,
              s.top5s, s.top10s, s.dnfs, s.avg_start AS avgStart, s.avg_finish AS avgFinish,
              s.laps_led AS lapsLed, s.points, s.playoff_points AS playoffPoints,
              s.loop_races AS loopRaces, s.avg_rating AS avgRating,
              s.top15_lap_pct AS top15LapPct, s.fast_lap_pct AS fastLapPct,
              s.pass_efficiency AS passEfficiency, s.adj_pass_efficiency AS adjPassEfficiency,
              s.avg_closing_gain AS avgClosingGain, s.closer_score AS closerScore,
              d.full_name AS fullName
       FROM driver_season_stats s
       JOIN drivers d ON d.driver_id = s.driver_id
       WHERE s.series_id = ?
       ORDER BY s.season, d.full_name`,
    )
    .all(seriesId) as unknown as SeasonStanding[];
}

/** Every track-type season row for a series, with driver name — powers the client track explorer. */
export function allTrackTypeStatsWithNames(
  db: Database,
  seriesId: number,
): Array<DriverTrackTypeStats & { fullName: string }> {
  return db
    .query(
      `SELECT t.driver_id AS driverId, t.series_id AS seriesId, t.season, t.track_type AS trackType,
              t.races, t.wins, t.top5s, t.top10s, t.dnfs, t.avg_start AS avgStart,
              t.avg_finish AS avgFinish, t.laps_led AS lapsLed, t.loop_races AS loopRaces,
              t.avg_rating AS avgRating, t.pass_efficiency AS passEfficiency,
              t.adj_pass_efficiency AS adjPassEfficiency,
              t.avg_closing_gain AS avgClosingGain, t.closer_score AS closerScore,
              d.full_name AS fullName
       FROM driver_track_type_stats t
       JOIN drivers d ON d.driver_id = t.driver_id
       WHERE t.series_id = ? AND t.races > 0
       ORDER BY t.season, t.track_type, d.full_name`,
    )
    .all(seriesId) as unknown as Array<DriverTrackTypeStats & { fullName: string }>;
}

export function latestSeasonWithStats(db: Database, seriesId: number): number | null {
  const row = db
    .query(`SELECT MAX(season) AS season FROM driver_season_stats WHERE series_id = ?`)
    .get(seriesId) as { season: number | null };
  return row.season;
}

// ---- Weekly recap reads ----

/** Per-race standouts for one race, name-joined, best adjPE first. */
export function raceStandoutsForRace(db: Database, raceId: number): RaceStandout[] {
  return db
    .query(
      `SELECT s.race_id AS raceId, s.series_id AS seriesId, s.season, s.driver_id AS driverId,
              s.adj_pass_efficiency AS adjPassEfficiency, s.closer_score AS closerScore,
              s.rating, d.full_name AS fullName
       FROM race_metric_standouts s
       JOIN drivers d ON d.driver_id = s.driver_id
       WHERE s.race_id = ?
       ORDER BY s.adj_pass_efficiency DESC`,
    )
    .all(raceId) as unknown as RaceStandout[];
}

/** Series/season/date for a race — lets the recap runtime derive context without the ingestion domain. */
export function raceContext(
  db: Database,
  raceId: number,
): { seriesId: number; season: number; raceDateUtc: string | null } | null {
  const row = db
    .query(
      `SELECT series_id AS seriesId, season,
              COALESCE(race_date_utc, race_date) AS raceDateUtc
       FROM races WHERE race_id = ?`,
    )
    .get(raceId) as { seriesId: number; season: number; raceDateUtc: string | null } | null;
  return row ?? null;
}

/** Every points-race finish for a season, name-joined, date-ordered — powers standings movement. */
export function seasonPointsResultsWithNames(
  db: Database,
  seriesId: number,
  season: number,
): SeasonPointsResultRow[] {
  return db
    .query(
      `SELECT res.race_id AS raceId, res.driver_id AS driverId, d.full_name AS fullName,
              res.finishing_position AS finish, res.points_earned AS points,
              COALESCE(r.race_date_utc, r.race_date) AS raceDateUtc
       FROM results res
       JOIN races r ON r.race_id = res.race_id
       JOIN drivers d ON d.driver_id = res.driver_id
       WHERE r.series_id = ? AND r.season = ? AND ${POINTS_FILTER}
       ORDER BY COALESCE(r.race_date_utc, r.race_date), res.race_id`,
    )
    .all(seriesId, season, POINTS_RACE_TYPE_ID, ...POINTS_RACE_ID_OVERRIDES) as unknown as SeasonPointsResultRow[];
}

/**
 * Each driver's trailing-form average finish as of the most recent race strictly
 * before `beforeDate` in `season` — the "form coming in" baseline for callouts.
 * Restricted to windows of at least `minWindow` races so the baseline is stable.
 */
export function priorFormForRace(
  db: Database,
  opts: { seriesId: number; season: number; beforeDate: string; minWindow: number },
): Array<{ driverId: number; avgFinish: number }> {
  return db
    .query(
      `SELECT f.driver_id AS driverId, f.avg_finish AS avgFinish
       FROM driver_form f
       JOIN (
         SELECT driver_id, MAX(race_date_utc) AS md
         FROM driver_form
         WHERE series_id = ? AND season = ? AND race_date_utc < ?
         GROUP BY driver_id
       ) last ON last.driver_id = f.driver_id AND last.md = f.race_date_utc
       WHERE f.series_id = ? AND f.season = ? AND f.window_races >= ?`,
    )
    .all(
      opts.seriesId, opts.season, opts.beforeDate,
      opts.seriesId, opts.season, opts.minWindow,
    ) as unknown as Array<{ driverId: number; avgFinish: number }>;
}

export function formForDriver(db: Database, driverId: number, seriesId: number): DriverFormRow[] {
  return db
    .query(
      `SELECT driver_id AS driverId, series_id AS seriesId, race_id AS raceId, season,
              race_date_utc AS raceDateUtc, window_races AS windowRaces,
              avg_finish AS avgFinish, avg_start AS avgStart,
              avg_rating AS avgRating, avg_closing_gain AS avgClosingGain
       FROM driver_form
       WHERE driver_id = ? AND series_id = ?
       ORDER BY race_date_utc, race_id`,
    )
    .all(driverId, seriesId) as unknown as DriverFormRow[];
}

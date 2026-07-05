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

export function latestSeasonWithStats(db: Database, seriesId: number): number | null {
  const row = db
    .query(`SELECT MAX(season) AS season FROM driver_season_stats WHERE series_id = ?`)
    .get(seriesId) as { season: number | null };
  return row.season;
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

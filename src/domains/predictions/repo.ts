// Predictions repo — owns race_predictions + dfs_projections, and reads the
// shared results/races/loop_stats tables to build strictly point-in-time
// inputs (every read is bounded by the target race's date, never joined to
// anything from the target race itself except its own metadata).
import type { Database } from "bun:sqlite";
import type {
  DfsProjectionRow,
  PredictionStage,
  PriorRaceRow,
  StoredPrediction,
} from "./types.ts";

/** Minimal race metadata the model needs. */
export interface PredictionRaceInfo {
  raceId: number;
  seriesId: number;
  season: number;
  raceName: string;
  trackType: string;
  raceDateUtc: string | null;
  scheduledLaps: number | null;
  hasResults: boolean;
}

// Points races only (race_type_id = 1; the 5580 override lives in the
// ingestion config — mirrored here as a plain literal to keep layers clean).
const POINTS_FILTER = `(r.race_type_id = 1 OR r.race_id = 5580)`;

export function raceInfo(db: Database, raceId: number): PredictionRaceInfo | null {
  return db
    .query(
      `SELECT r.race_id AS raceId, r.series_id AS seriesId, r.season, r.race_name AS raceName,
              r.track_type AS trackType, r.race_date_utc AS raceDateUtc,
              r.scheduled_laps AS scheduledLaps,
              EXISTS(SELECT 1 FROM results res WHERE res.race_id = r.race_id) AS hasResults
       FROM races r WHERE r.race_id = ?`,
    )
    .get(raceId) as PredictionRaceInfo | null;
}

/**
 * The next points race (by date) that has no results yet. Future races carry
 * race_type_id NULL (the type arrives with the weekend feed at ingest), so
 * unknown types count as points here — exhibition variants get corrected the
 * moment they're ingested.
 */
export function nextRaceWithoutResults(
  db: Database,
  seriesId: number,
  nowIso: string,
): PredictionRaceInfo | null {
  const row = db
    .query(
      `SELECT r.race_id AS raceId FROM races r
       WHERE r.series_id = ? AND (r.race_type_id = 1 OR r.race_type_id IS NULL)
         AND r.race_date_utc IS NOT NULL AND r.race_date_utc >= ?
         AND NOT EXISTS (SELECT 1 FROM results res WHERE res.race_id = r.race_id)
       ORDER BY r.race_date_utc ASC LIMIT 1`,
    )
    .get(seriesId, nowIso) as { raceId: number } | null;
  return row ? raceInfo(db, row.raceId) : null;
}

/** Ids of the last N completed points races strictly before a date. */
export function lastCompletedRaceIds(
  db: Database,
  seriesId: number,
  beforeDateUtc: string,
  limit: number,
): number[] {
  const rows = db
    .query(
      `SELECT r.race_id AS raceId FROM races r
       WHERE r.series_id = ? AND ${POINTS_FILTER} AND r.race_date_utc < ?
         AND EXISTS (SELECT 1 FROM results res WHERE res.race_id = r.race_id)
       ORDER BY r.race_date_utc DESC LIMIT ?`,
    )
    .all(seriesId, beforeDateUtc, limit) as Array<{ raceId: number }>;
  return rows.map((r) => r.raceId);
}

/** Distinct drivers across a set of races (the entry-list heuristic). */
export function driversInRaces(
  db: Database,
  raceIds: number[],
): Array<{ driverId: number; fullName: string }> {
  if (raceIds.length === 0) return [];
  const marks = raceIds.map(() => "?").join(",");
  return db
    .query(
      `SELECT DISTINCT res.driver_id AS driverId, d.full_name AS fullName
       FROM results res JOIN drivers d ON d.driver_id = res.driver_id
       WHERE res.race_id IN (${marks}) AND res.finishing_position > 0
       ORDER BY d.full_name`,
    )
    .all(...raceIds) as Array<{ driverId: number; fullName: string }>;
}

/** A driver's prior points races strictly before a date, newest first. */
export function priorRaces(
  db: Database,
  driverId: number,
  seriesId: number,
  beforeDateUtc: string,
  limit: number,
): PriorRaceRow[] {
  const rows = db
    .query(
      `SELECT res.race_id AS raceId, r.race_date_utc AS raceDateUtc, r.track_type AS trackType,
              res.finishing_position AS finish, res.starting_position AS start,
              (res.finishing_status IS NOT NULL AND TRIM(res.finishing_status) <> ''
               AND TRIM(res.finishing_status) <> 'Running'
               AND res.finishing_status NOT LIKE 'Stage%') AS dnf,
              ls.rating, res.laps_led AS lapsLed, ls.fast_laps AS fastLaps,
              r.actual_laps AS raceLaps
       FROM results res
       JOIN races r ON r.race_id = res.race_id
       LEFT JOIN loop_stats ls ON ls.race_id = res.race_id AND ls.driver_id = res.driver_id
       WHERE res.driver_id = ? AND r.series_id = ? AND ${POINTS_FILTER}
         AND r.race_date_utc < ? AND res.finishing_position > 0
       ORDER BY r.race_date_utc DESC LIMIT ?`,
    )
    .all(driverId, seriesId, beforeDateUtc, limit) as unknown as Array<
    Omit<PriorRaceRow, "dnf"> & { dnf: number }
  >;
  return rows.map((r) => ({ ...r, dnf: r.dnf === 1 }));
}

/** driver_id → starting_position for a completed race (backtest saturdays). */
export function startingPositions(db: Database, raceId: number): Map<number, number> {
  const rows = db
    .query(
      `SELECT driver_id AS driverId, starting_position AS start FROM results
       WHERE race_id = ? AND starting_position > 0`,
    )
    .all(raceId) as Array<{ driverId: number; start: number }>;
  return new Map(rows.map((r) => [r.driverId, r.start]));
}

/** Actual results for the predicted-vs-actual view and the backtest. */
export function actualFinishes(
  db: Database,
  raceId: number,
): Map<number, { finish: number; lapsLed: number }> {
  const rows = db
    .query(
      `SELECT driver_id AS driverId, finishing_position AS finish, laps_led AS lapsLed
       FROM results WHERE race_id = ? AND finishing_position > 0`,
    )
    .all(raceId) as Array<{ driverId: number; finish: number; lapsLed: number }>;
  return new Map(rows.map((r) => [r.driverId, { finish: r.finish, lapsLed: r.lapsLed }]));
}

// --- owned tables ---

export function upsertPredictions(db: Database, rows: StoredPrediction[]): void {
  const stmt = db.query(
    `INSERT INTO race_predictions (race_id, driver_id, stage, generated_at, basis_race_id,
       start_pos, rating, p_win, p_top5, p_top10, exp_finish, exp_laps_led, exp_fast_laps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (race_id, driver_id, stage) DO UPDATE SET
       generated_at = excluded.generated_at, basis_race_id = excluded.basis_race_id,
       start_pos = excluded.start_pos, rating = excluded.rating,
       p_win = excluded.p_win, p_top5 = excluded.p_top5, p_top10 = excluded.p_top10,
       exp_finish = excluded.exp_finish, exp_laps_led = excluded.exp_laps_led,
       exp_fast_laps = excluded.exp_fast_laps`,
  );
  const run = db.transaction(() => {
    for (const p of rows)
      stmt.run(
        p.raceId, p.driverId, p.stage, p.generatedAt, p.basisRaceId, p.startPos,
        p.rating, p.pWin, p.pTop5, p.pTop10, p.expFinish, p.expLapsLed, p.expFastLaps,
      );
  });
  run();
}

export function latestPredictions(
  db: Database,
  raceId: number,
): { stage: PredictionStage; rows: Array<StoredPrediction & { fullName: string }> } | null {
  for (const stage of ["saturday", "thursday"] as const) {
    const rows = db
      .query(
        `SELECT rp.race_id AS raceId, rp.driver_id AS driverId, d.full_name AS fullName,
                rp.stage, rp.generated_at AS generatedAt, rp.basis_race_id AS basisRaceId,
                rp.start_pos AS startPos, rp.rating, rp.p_win AS pWin, rp.p_top5 AS pTop5,
                rp.p_top10 AS pTop10, rp.exp_finish AS expFinish,
                rp.exp_laps_led AS expLapsLed, rp.exp_fast_laps AS expFastLaps
         FROM race_predictions rp JOIN drivers d ON d.driver_id = rp.driver_id
         WHERE rp.race_id = ? AND rp.stage = ? ORDER BY rp.p_win DESC, rp.exp_finish ASC`,
      )
      .all(raceId, stage) as Array<StoredPrediction & { fullName: string }>;
    if (rows.length > 0) return { stage, rows };
  }
  return null;
}

/** The most recent race that has any stored prediction (for page routing). */
export function latestPredictedRaceId(db: Database, seriesId: number): number | null {
  const row = db
    .query(
      `SELECT rp.race_id AS raceId FROM race_predictions rp
       JOIN races r ON r.race_id = rp.race_id
       WHERE r.series_id = ? ORDER BY r.race_date_utc DESC LIMIT 1`,
    )
    .get(seriesId) as { raceId: number } | null;
  return row?.raceId ?? null;
}

export function upsertProjections(db: Database, rows: DfsProjectionRow[]): void {
  const stmt = db.query(
    `INSERT INTO dfs_projections (race_id, driver_id, stage, platform, projected_points,
       projected_start, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (race_id, driver_id, stage, platform) DO UPDATE SET
       projected_points = excluded.projected_points,
       projected_start = excluded.projected_start, generated_at = excluded.generated_at`,
  );
  const run = db.transaction(() => {
    for (const p of rows)
      stmt.run(p.raceId, p.driverId, p.stage, p.platform, p.projectedPoints, p.projectedStart, p.generatedAt);
  });
  run();
}

export function latestProjections(
  db: Database,
  raceId: number,
  platform: string,
): DfsProjectionRow[] {
  for (const stage of ["saturday", "thursday"] as const) {
    const rows = db
      .query(
        `SELECT dp.race_id AS raceId, dp.driver_id AS driverId, d.full_name AS fullName,
                dp.stage, dp.platform, dp.projected_points AS projectedPoints,
                dp.projected_start AS projectedStart, dp.generated_at AS generatedAt
         FROM dfs_projections dp JOIN drivers d ON d.driver_id = dp.driver_id
         WHERE dp.race_id = ? AND dp.stage = ? AND dp.platform = ?
         ORDER BY dp.projected_points DESC`,
      )
      .all(raceId, stage, platform) as DfsProjectionRow[];
    if (rows.length > 0) return rows;
  }
  return [];
}

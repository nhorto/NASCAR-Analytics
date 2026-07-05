import type { Database } from "bun:sqlite";
import type {
  TrackRow,
  RaceRow,
  DriverRow,
  ResultRow,
  LoopStatRow,
  LapTimeRow,
  CautionRow,
  RaceLeaderRow,
  ScheduledRace,
  SeasonCoverage,
  TrackType,
} from "./types.ts";

export function upsertTrack(db: Database, row: TrackRow): void {
  db.query(
    `INSERT INTO tracks (track_id, name, default_track_type) VALUES (?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET name = excluded.name`,
  ).run(row.trackId, row.name, row.defaultTrackType);
}

/** Insert a race known only from the schedule feed; keeps schedule-sourced
 * fields fresh without clobbering weekend-feed enrichment. */
export function upsertScheduledRace(
  db: Database,
  race: ScheduledRace,
  trackType: TrackType,
): void {
  db.query(
    `INSERT INTO races (race_id, series_id, season, race_name, track_id, track_type, race_date_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(race_id) DO UPDATE SET
       race_name = excluded.race_name,
       race_date_utc = excluded.race_date_utc,
       track_id = excluded.track_id,
       track_type = excluded.track_type`,
  ).run(
    race.raceId,
    race.seriesId,
    race.season,
    race.raceName,
    race.trackId,
    trackType,
    race.startTimeUtc,
  );
}

/** Enrich a race row with weekend-feed detail. */
export function updateRaceDetails(db: Database, row: RaceRow): void {
  db.query(
    `UPDATE races SET
       race_name = ?, race_type_id = ?, track_id = ?, track_type = ?, race_date = ?,
       restrictor_plate = ?, scheduled_laps = ?, actual_laps = ?,
       stage_1_laps = ?, stage_2_laps = ?, stage_3_laps = ?,
       cars_in_field = ?, pole_winner_driver_id = ?, lead_changes = ?, leaders = ?,
       cautions = ?, caution_laps = ?, average_speed = ?, total_race_time = ?, margin_of_victory = ?
     WHERE race_id = ?`,
  ).run(
    row.raceName,
    row.raceTypeId,
    row.trackId,
    row.trackType,
    row.raceDate,
    row.restrictorPlate ? 1 : 0,
    row.scheduledLaps,
    row.actualLaps,
    row.stage1Laps,
    row.stage2Laps,
    row.stage3Laps,
    row.carsInField,
    row.poleWinnerDriverId,
    row.leadChanges,
    row.leaders,
    row.cautions,
    row.cautionLaps,
    row.averageSpeed,
    row.totalRaceTime,
    row.marginOfVictory,
    row.raceId,
  );
}

export function upsertDrivers(db: Database, rows: DriverRow[]): void {
  const stmt = db.query(
    `INSERT INTO drivers (driver_id, full_name) VALUES (?, ?)
     ON CONFLICT(driver_id) DO UPDATE SET full_name = excluded.full_name`,
  );
  const run = db.transaction((items: DriverRow[]) => {
    for (const r of items) stmt.run(r.driverId, r.fullName);
  });
  run(rows);
}

export function upsertResults(db: Database, rows: ResultRow[]): void {
  const stmt = db.query(
    `INSERT OR REPLACE INTO results (
       race_id, driver_id, finishing_position, starting_position, car_number,
       team_id, team_name, qualifying_position, qualifying_speed, laps_led, times_led,
       car_make, sponsor, points_earned, playoff_points_earned, laps_completed,
       finishing_status, points_position, disqualified
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction((items: ResultRow[]) => {
    for (const r of items) {
      stmt.run(
        r.raceId,
        r.driverId,
        r.finishingPosition,
        r.startingPosition,
        r.carNumber,
        r.teamId,
        r.teamName,
        r.qualifyingPosition,
        r.qualifyingSpeed,
        r.lapsLed,
        r.timesLed,
        r.carMake,
        r.sponsor,
        r.pointsEarned,
        r.playoffPointsEarned,
        r.lapsCompleted,
        r.finishingStatus,
        r.pointsPosition,
        r.disqualified ? 1 : 0,
      );
    }
  });
  run(rows);
}

export function upsertLoopStats(db: Database, rows: LoopStatRow[]): void {
  const stmt = db.query(
    `INSERT OR REPLACE INTO loop_stats (
       race_id, driver_id, start_ps, mid_ps, finish_ps, closing_ps, closing_laps_diff,
       best_ps, worst_ps, avg_ps, passes_gf, passing_diff, passed_gf, quality_passes,
       fast_laps, top15_laps, lead_laps, laps, rating
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction((items: LoopStatRow[]) => {
    for (const r of items) {
      stmt.run(
        r.raceId,
        r.driverId,
        r.startPs,
        r.midPs,
        r.finishPs,
        r.closingPs,
        r.closingLapsDiff,
        r.bestPs,
        r.worstPs,
        r.avgPs,
        r.passesGf,
        r.passingDiff,
        r.passedGf,
        r.qualityPasses,
        r.fastLaps,
        r.top15Laps,
        r.leadLaps,
        r.laps,
        r.rating,
      );
    }
  });
  run(rows);
}

export function upsertLapTimes(db: Database, rows: LapTimeRow[]): void {
  const stmt = db.query(
    `INSERT OR REPLACE INTO lap_times (race_id, driver_id, lap, lap_time, lap_speed, running_pos)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction((items: LapTimeRow[]) => {
    for (const r of items) {
      stmt.run(r.raceId, r.driverId, r.lap, r.lapTime, r.lapSpeed, r.runningPos);
    }
  });
  run(rows);
}

export function replaceCautions(db: Database, raceId: number, rows: CautionRow[]): void {
  const run = db.transaction(() => {
    db.query(`DELETE FROM cautions WHERE race_id = ?`).run(raceId);
    const stmt = db.query(
      `INSERT INTO cautions (race_id, start_lap, end_lap, reason, comment, flag_state)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      stmt.run(r.raceId, r.startLap, r.endLap, r.reason, r.comment, r.flagState);
    }
  });
  run();
}

export function replaceRaceLeaders(db: Database, raceId: number, rows: RaceLeaderRow[]): void {
  const run = db.transaction(() => {
    db.query(`DELETE FROM race_leaders WHERE race_id = ?`).run(raceId);
    const stmt = db.query(
      `INSERT INTO race_leaders (race_id, start_lap, end_lap, car_number)
       VALUES (?, ?, ?, ?)`,
    );
    for (const r of rows) {
      stmt.run(r.raceId, r.startLap, r.endLap, r.carNumber);
    }
  });
  run();
}

export function recordRawFetch(
  db: Database,
  fetch: { url: string; localPath: string | null; sha256: string | null; httpStatus: number },
): void {
  db.query(
    `INSERT INTO raw_fetches (url, local_path, sha256, http_status) VALUES (?, ?, ?, ?)`,
  ).run(fetch.url, fetch.localPath, fetch.sha256, fetch.httpStatus);
}

export function hasResults(db: Database, raceId: number): boolean {
  return existsIn(db, "results", raceId);
}

export function hasLoopStats(db: Database, raceId: number): boolean {
  return existsIn(db, "loop_stats", raceId);
}

export function hasLapTimes(db: Database, raceId: number): boolean {
  return existsIn(db, "lap_times", raceId);
}

function existsIn(db: Database, table: string, raceId: number): boolean {
  const row = db
    .query(`SELECT 1 AS present FROM ${table} WHERE race_id = ? LIMIT 1`)
    .get(raceId);
  return row !== null;
}

export function coverageBySeason(db: Database, seriesId: number): SeasonCoverage[] {
  return db
    .query(
      `SELECT
         r.season AS season,
         COUNT(*) AS scheduledRaces,
         SUM(EXISTS (SELECT 1 FROM results x WHERE x.race_id = r.race_id)) AS racesWithResults,
         SUM(EXISTS (SELECT 1 FROM loop_stats x WHERE x.race_id = r.race_id)) AS racesWithLoopStats,
         SUM(EXISTS (SELECT 1 FROM lap_times x WHERE x.race_id = r.race_id)) AS racesWithLapTimes
       FROM races r
       WHERE r.series_id = ?
       GROUP BY r.season
       ORDER BY r.season`,
    )
    .all(seriesId) as unknown as SeasonCoverage[];
}

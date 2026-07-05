import type { Database } from "bun:sqlite";
import type {
  DriverSummary,
  DriverRaceLogEntry,
  IdentityIssue,
  CareerSeasonRow,
} from "./types.ts";
import { POINTS_RACE_TYPE_ID } from "./config.ts";

/** Career summaries over points races, newest team/number from the most recent start. */
export function listDriverSummaries(db: Database, seriesId: number): DriverSummary[] {
  return db
    .query(
      `WITH starts AS (
         SELECT res.driver_id, res.team_name, res.car_number, res.car_make,
                res.finishing_position, r.season,
                COALESCE(r.race_date_utc, r.race_date) AS race_date
         FROM results res
         JOIN races r ON r.race_id = res.race_id
         WHERE r.series_id = ? AND r.race_type_id = ?
       ),
       latest AS (
         SELECT driver_id, team_name, car_number, car_make,
                ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY race_date DESC) AS rn
         FROM starts
       )
       SELECT s.driver_id AS driverId,
              d.full_name AS fullName,
              MIN(s.season) AS firstSeason,
              MAX(s.season) AS lastSeason,
              COUNT(*) AS races,
              SUM(s.finishing_position = 1) AS wins,
              l.team_name AS latestTeam,
              l.car_number AS latestCarNumber,
              l.car_make AS latestCarMake
       FROM starts s
       JOIN drivers d ON d.driver_id = s.driver_id
       JOIN latest l ON l.driver_id = s.driver_id AND l.rn = 1
       GROUP BY s.driver_id
       ORDER BY races DESC, fullName`,
    )
    .all(seriesId, POINTS_RACE_TYPE_ID) as unknown as DriverSummary[];
}

/** All races (points and exhibition) for one driver, newest first. */
export function raceLogForDriver(
  db: Database,
  driverId: number,
  seriesId: number,
): DriverRaceLogEntry[] {
  const rows = db
    .query(
      `SELECT res.race_id AS raceId,
              r.season AS season,
              COALESCE(r.race_date_utc, r.race_date) AS raceDateUtc,
              r.race_name AS raceName,
              r.track_type AS trackType,
              res.starting_position AS start,
              res.finishing_position AS finish,
              res.finishing_status AS status,
              res.laps_led AS lapsLed,
              res.points_earned AS points,
              ls.rating AS rating,
              res.disqualified AS disqualified
       FROM results res
       JOIN races r ON r.race_id = res.race_id
       LEFT JOIN loop_stats ls ON ls.race_id = res.race_id AND ls.driver_id = res.driver_id
       WHERE res.driver_id = ? AND r.series_id = ?
       ORDER BY COALESCE(r.race_date_utc, r.race_date) DESC, res.race_id DESC`,
    )
    .all(driverId, seriesId) as unknown as Array<
    Omit<DriverRaceLogEntry, "disqualified"> & { disqualified: number }
  >;
  return rows.map((r) => ({ ...r, disqualified: r.disqualified === 1 }));
}

/** Per (series, season) points-race totals for one driver, newest season first. */
export function careerSeasonRows(db: Database, driverId: number): CareerSeasonRow[] {
  return db
    .query(
      `SELECT r.series_id AS seriesId,
              r.season AS season,
              COUNT(*) AS races,
              SUM(res.finishing_position = 1) AS wins,
              SUM(res.finishing_position <= 5) AS top5s,
              SUM(res.finishing_position <= 10) AS top10s,
              AVG(res.finishing_position) AS avgFinish
       FROM results res
       JOIN races r ON r.race_id = res.race_id
       WHERE res.driver_id = ? AND r.race_type_id = ?
       GROUP BY r.series_id, r.season
       ORDER BY r.season DESC, r.series_id`,
    )
    .all(driverId, POINTS_RACE_TYPE_ID) as unknown as CareerSeasonRow[];
}

/** Name + the driver's most recent ride across all series; null if no starts. */
export function careerIdentity(
  db: Database,
  driverId: number,
): { fullName: string; latestTeam: string | null; latestCarNumber: string | null; latestCarMake: string | null } | null {
  return (
    (db
      .query(
        `SELECT d.full_name AS fullName,
                res.team_name AS latestTeam,
                res.car_number AS latestCarNumber,
                res.car_make AS latestCarMake
         FROM results res
         JOIN races r ON r.race_id = res.race_id
         JOIN drivers d ON d.driver_id = res.driver_id
         WHERE res.driver_id = ?
         ORDER BY COALESCE(r.race_date_utc, r.race_date) DESC, res.race_id DESC
         LIMIT 1`,
      )
      .get(driverId) as {
      fullName: string;
      latestTeam: string | null;
      latestCarNumber: string | null;
      latestCarMake: string | null;
    } | null) ?? null
  );
}

export function findDriverIdByName(db: Database, name: string): number | null {
  const exact = db
    .query(`SELECT driver_id AS id FROM drivers WHERE lower(full_name) = lower(?)`)
    .get(name) as { id: number } | null;
  if (exact) return exact.id;
  const partial = db
    .query(
      `SELECT driver_id AS id FROM drivers
       WHERE full_name LIKE '%' || ? || '%' COLLATE NOCASE
       ORDER BY full_name LIMIT 1`,
    )
    .get(name) as { id: number } | null;
  return partial?.id ?? null;
}

/** Same full name under multiple driver_ids — would signal CDN id instability. */
export function duplicateNames(db: Database): IdentityIssue[] {
  const rows = db
    .query(
      `SELECT full_name AS fullName, GROUP_CONCAT(driver_id) AS ids
       FROM drivers GROUP BY lower(full_name) HAVING COUNT(*) > 1`,
    )
    .all() as Array<{ fullName: string; ids: string }>;
  return rows.map((r) => ({
    fullName: r.fullName,
    driverIds: r.ids.split(",").map((s) => Number.parseInt(s, 10)),
  }));
}

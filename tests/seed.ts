// Shared seeding helpers for domain tests: an in-memory db with the real
// schema, and terse row factories with sensible defaults.
import type { Database } from "bun:sqlite";
import { createDb } from "../src/providers/db.ts";

export function testDb(): Database {
  return createDb(":memory:");
}

export function seedDriver(db: Database, driverId: number, fullName: string): void {
  db.query(`INSERT OR REPLACE INTO drivers (driver_id, full_name) VALUES (?, ?)`).run(
    driverId,
    fullName,
  );
}

export function seedRace(
  db: Database,
  opts: {
    raceId: number;
    season: number;
    seriesId?: number;
    raceTypeId?: number | null;
    trackType?: string;
    raceDateUtc?: string;
    raceName?: string;
  },
): void {
  db.query(
    `INSERT OR REPLACE INTO races
       (race_id, series_id, season, race_name, race_type_id, track_id, track_type, race_date_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.raceId,
    opts.seriesId ?? 1,
    opts.season,
    opts.raceName ?? `Race ${opts.raceId}`,
    opts.raceTypeId === undefined ? 1 : opts.raceTypeId,
    1,
    opts.trackType ?? "intermediate",
    opts.raceDateUtc ?? `${opts.season}-06-01T18:00:00`,
  );
}

export function seedResult(
  db: Database,
  opts: {
    raceId: number;
    driverId: number;
    finish: number;
    start?: number | null;
    status?: string;
    lapsLed?: number;
    points?: number;
    playoffPoints?: number;
    teamName?: string;
    carNumber?: string;
    disqualified?: boolean;
  },
): void {
  db.query(
    `INSERT OR REPLACE INTO results
       (race_id, driver_id, finishing_position, starting_position, finishing_status,
        laps_led, points_earned, playoff_points_earned, team_name, car_number, disqualified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.raceId,
    opts.driverId,
    opts.finish,
    opts.start === undefined ? opts.finish : opts.start,
    opts.status ?? "Running",
    opts.lapsLed ?? 0,
    opts.points ?? 0,
    opts.playoffPoints ?? 0,
    opts.teamName ?? "Test Team",
    opts.carNumber ?? "00",
    opts.disqualified ? 1 : 0,
  );
}

export function seedLoop(
  db: Database,
  opts: {
    raceId: number;
    driverId: number;
    avgPs: number;
    closingPs?: number;
    closingLapsDiff?: number;
    passesGf?: number;
    passedGf?: number;
    fastLaps?: number;
    top15Laps?: number;
    laps?: number;
    rating?: number;
  },
): void {
  db.query(
    `INSERT OR REPLACE INTO loop_stats
       (race_id, driver_id, avg_ps, closing_ps, closing_laps_diff,
        passes_gf, passed_gf, fast_laps, top15_laps, laps, rating)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.raceId,
    opts.driverId,
    opts.avgPs,
    opts.closingPs ?? Math.round(opts.avgPs),
    opts.closingLapsDiff ?? 0,
    opts.passesGf ?? 0,
    opts.passedGf ?? 0,
    opts.fastLaps ?? 0,
    opts.top15Laps ?? 0,
    opts.laps ?? 100,
    opts.rating ?? 80,
  );
}

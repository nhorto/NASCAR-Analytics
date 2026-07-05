import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  track_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  default_track_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS races (
  race_id INTEGER PRIMARY KEY,
  series_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  race_name TEXT NOT NULL,
  race_type_id INTEGER,
  track_id INTEGER NOT NULL,
  track_type TEXT NOT NULL DEFAULT 'unknown',
  race_date TEXT,
  race_date_utc TEXT,
  restrictor_plate INTEGER,
  scheduled_laps INTEGER,
  actual_laps INTEGER,
  stage_1_laps INTEGER,
  stage_2_laps INTEGER,
  stage_3_laps INTEGER,
  cars_in_field INTEGER,
  pole_winner_driver_id INTEGER,
  lead_changes INTEGER,
  leaders INTEGER,
  cautions INTEGER,
  caution_laps INTEGER,
  average_speed REAL,
  total_race_time TEXT,
  margin_of_victory TEXT
);
CREATE INDEX IF NOT EXISTS idx_races_season ON races(season, series_id);

CREATE TABLE IF NOT EXISTS drivers (
  driver_id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  race_id INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  finishing_position INTEGER NOT NULL,
  starting_position INTEGER,
  car_number TEXT,
  team_id INTEGER,
  team_name TEXT,
  qualifying_position INTEGER,
  qualifying_speed REAL,
  laps_led INTEGER,
  times_led INTEGER,
  car_make TEXT,
  sponsor TEXT,
  points_earned INTEGER,
  playoff_points_earned INTEGER,
  laps_completed INTEGER,
  finishing_status TEXT,
  points_position INTEGER,
  disqualified INTEGER,
  PRIMARY KEY (race_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_results_driver ON results(driver_id);

CREATE TABLE IF NOT EXISTS loop_stats (
  race_id INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  start_ps INTEGER,
  mid_ps INTEGER,
  finish_ps INTEGER,
  closing_ps INTEGER,
  closing_laps_diff INTEGER,
  best_ps INTEGER,
  worst_ps INTEGER,
  avg_ps REAL,
  passes_gf INTEGER,
  passing_diff INTEGER,
  passed_gf INTEGER,
  quality_passes INTEGER,
  fast_laps INTEGER,
  top15_laps INTEGER,
  lead_laps INTEGER,
  laps INTEGER,
  rating REAL,
  PRIMARY KEY (race_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_loop_stats_driver ON loop_stats(driver_id);

CREATE TABLE IF NOT EXISTS lap_times (
  race_id INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  lap INTEGER NOT NULL,
  lap_time REAL,
  lap_speed REAL,
  running_pos INTEGER,
  PRIMARY KEY (race_id, driver_id, lap)
);
CREATE INDEX IF NOT EXISTS idx_lap_times_race ON lap_times(race_id);

CREATE TABLE IF NOT EXISTS cautions (
  race_id INTEGER NOT NULL,
  start_lap INTEGER NOT NULL,
  end_lap INTEGER NOT NULL,
  reason TEXT,
  comment TEXT,
  flag_state INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cautions_race ON cautions(race_id);

CREATE TABLE IF NOT EXISTS race_leaders (
  race_id INTEGER NOT NULL,
  start_lap INTEGER NOT NULL,
  end_lap INTEGER NOT NULL,
  car_number TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_race_leaders_race ON race_leaders(race_id);

-- Analytics: pre-computed metrics, fully rebuilt by each compute run.
CREATE TABLE IF NOT EXISTS driver_season_stats (
  driver_id INTEGER NOT NULL,
  series_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  races INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  top5s INTEGER NOT NULL,
  top10s INTEGER NOT NULL,
  dnfs INTEGER NOT NULL,
  avg_start REAL,
  avg_finish REAL,
  laps_led INTEGER NOT NULL,
  points INTEGER NOT NULL,
  playoff_points INTEGER NOT NULL,
  loop_races INTEGER NOT NULL,
  avg_rating REAL,
  top15_lap_pct REAL,
  fast_lap_pct REAL,
  pass_efficiency REAL,
  adj_pass_efficiency REAL,
  avg_closing_gain REAL,
  closer_score REAL,
  PRIMARY KEY (driver_id, series_id, season)
);
CREATE INDEX IF NOT EXISTS idx_season_stats_season ON driver_season_stats(season, series_id);

CREATE TABLE IF NOT EXISTS driver_track_type_stats (
  driver_id INTEGER NOT NULL,
  series_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  track_type TEXT NOT NULL,
  races INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  top5s INTEGER NOT NULL,
  top10s INTEGER NOT NULL,
  dnfs INTEGER NOT NULL,
  avg_start REAL,
  avg_finish REAL,
  laps_led INTEGER NOT NULL,
  loop_races INTEGER NOT NULL,
  avg_rating REAL,
  pass_efficiency REAL,
  adj_pass_efficiency REAL,
  avg_closing_gain REAL,
  closer_score REAL,
  PRIMARY KEY (driver_id, series_id, season, track_type)
);

CREATE TABLE IF NOT EXISTS driver_form (
  driver_id INTEGER NOT NULL,
  series_id INTEGER NOT NULL,
  race_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  race_date_utc TEXT,
  window_races INTEGER NOT NULL,
  avg_finish REAL NOT NULL,
  avg_start REAL,
  avg_rating REAL,
  avg_closing_gain REAL,
  PRIMARY KEY (driver_id, race_id)
);
CREATE INDEX IF NOT EXISTS idx_driver_form_driver ON driver_form(driver_id, season);

-- Per-race single-race residuals for the two proprietary metrics, for the
-- weekly recap. One row per (race, driver); rebuilt by each compute run.
CREATE TABLE IF NOT EXISTS race_metric_standouts (
  race_id INTEGER NOT NULL,
  series_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  adj_pass_efficiency REAL,
  closer_score REAL,
  rating REAL,
  PRIMARY KEY (race_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_race_standouts_race ON race_metric_standouts(race_id);

CREATE TABLE IF NOT EXISTS raw_fetches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  local_path TEXT,
  sha256 TEXT,
  http_status INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_raw_fetches_url ON raw_fetches(url);
`;

export function createDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

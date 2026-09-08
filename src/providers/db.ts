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

-- Data-health: one row per canary check per run (domains/data-health/repo.ts).
-- The consecutive-failure/outage logic reads the latest runs per check.
CREATE TABLE IF NOT EXISTS feed_status (
  check_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  http_status INTEGER NOT NULL,
  problem TEXT,
  ms INTEGER NOT NULL,
  PRIMARY KEY (check_id, run_at)
);
CREATE INDEX IF NOT EXISTS idx_feed_status_check ON feed_status(check_id, run_at DESC);

-- Cross-process advisory locks (providers/lock.ts): the in-process refresh
-- cron and any manual CLI run coordinate through this table.
CREATE TABLE IF NOT EXISTS app_locks (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Accounts (domains/accounts/repo.ts): password auth per spec §6. The db
-- stores only SHA-256 hashes of session/verify/reset tokens, never the raw
-- values; emails are stored lowercased by the service.
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);

-- Sliding-window rate limiting for auth endpoints; rows are pruned as they
-- age out of the largest window.
CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_key ON auth_attempts(key, at);

-- Billing (domains/billing/repo.ts): the entitlement model of spec §7. Pro is
-- on iff pro_until is in the future; WS-E's Stripe webhooks become the main
-- writer, manual grants exist for testers.
CREATE TABLE IF NOT EXISTS entitlements (
  user_id INTEGER PRIMARY KEY,
  pro_until TEXT NOT NULL,
  pro_source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Stripe webhook ledger (domains/billing/repo.ts, WS-E): every delivered
-- event id, exactly once — the idempotency key for Stripe's at-least-once
-- delivery, and an audit trail for "why is my plan wrong?" support.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created INTEGER NOT NULL,
  received_at TEXT NOT NULL
);

-- One row per user who has touched Stripe: the customer/subscription mapping
-- the webhook state machine needs, plus status fields the UI shows (past-due
-- banner, "cancels at period end"). last_event_created is the monotonic guard
-- that makes out-of-order webhook delivery safe.
CREATE TABLE IF NOT EXISTS billing_profiles (
  user_id INTEGER PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE,
  subscription_id TEXT,
  subscription_status TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  current_period_end INTEGER,
  last_event_created INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Per-channel entitlement grants (domains/billing/repo.ts, WS-J). Stripe and
-- RevenueCat are independent writers, so neither may own entitlements
-- outright: each writes only its own (channel, kind) slot here, and
-- entitlements.pro_until is the projection — the max across the surviving
-- grants. That is what stops an IAP refund from stripping a web season pass
-- (and the reverse), which a single mutable row cannot express.
CREATE TABLE IF NOT EXISTS billing_grants (
  user_id INTEGER NOT NULL,
  -- stripe | revenuecat | manual
  channel TEXT NOT NULL,
  -- subscription | season_pass | manual (one slot per product shape)
  kind TEXT NOT NULL,
  pro_until TEXT NOT NULL,
  -- the pro_source this grant projects when it wins
  pro_source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel, kind)
);

-- RevenueCat webhook ledger (domains/billing/repo.ts, WS-J): the mirror of
-- stripe_events. RevenueCat also delivers at least once and retries for days,
-- so the event id is the idempotency key for the store channel.
CREATE TABLE IF NOT EXISTS revenuecat_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  -- event_timestamp_ms from the payload
  event_at INTEGER NOT NULL,
  received_at TEXT NOT NULL
);

-- One row per user who has bought through a store. The RevenueCat twin of
-- billing_profiles: app_user_id is how their events find us, the status
-- fields are what support and the UI read, and last_event_at is the monotonic
-- guard that makes out-of-order delivery safe.
CREATE TABLE IF NOT EXISTS revenuecat_profiles (
  user_id INTEGER PRIMARY KEY,
  app_user_id TEXT NOT NULL,
  -- APP_STORE | PLAY_STORE | ... and PRODUCTION | SANDBOX; kept because a
  -- sandbox grant looks identical to a real one without them.
  store TEXT,
  environment TEXT,
  product_id TEXT,
  entitlement_status TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  last_event_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- RevenueCat app_user_id aliases: a purchase can start under an anonymous id
-- and be merged into the signed-in one, so later events may arrive under an
-- id that is not our user id. SUBSCRIBER_ALIAS records the mapping.
CREATE TABLE IF NOT EXISTS revenuecat_aliases (
  alias_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revenuecat_aliases_user ON revenuecat_aliases(user_id);

-- Predictions (domains/predictions/repo.ts): one row per driver per stage
-- per race; regenerated by each predict run (upsert, last write wins).
CREATE TABLE IF NOT EXISTS race_predictions (
  race_id INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  basis_race_id INTEGER,
  start_pos INTEGER,
  rating REAL NOT NULL,
  p_win REAL NOT NULL,
  p_top5 REAL NOT NULL,
  p_top10 REAL NOT NULL,
  exp_finish REAL NOT NULL,
  exp_laps_led REAL NOT NULL,
  exp_fast_laps REAL NOT NULL,
  PRIMARY KEY (race_id, driver_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_race_predictions_race ON race_predictions(race_id, stage);

CREATE TABLE IF NOT EXISTS dfs_projections (
  race_id INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  platform TEXT NOT NULL,
  projected_points REAL NOT NULL,
  projected_start REAL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (race_id, driver_id, stage, platform)
);
CREATE INDEX IF NOT EXISTS idx_dfs_projections_race ON dfs_projections(race_id, stage, platform);

-- Email preferences + deliverability (domains/accounts/repo.ts, WS-G). One row
-- per user; both digests default off (opt-in). unsub_token is a per-user secret
-- used by the one-tap unsubscribe links. bounced_at/complained_at are set by
-- the Resend webhook and suppress every future digest to that address.
CREATE TABLE IF NOT EXISTS email_prefs (
  user_id INTEGER PRIMARY KEY,
  recap INTEGER NOT NULL DEFAULT 0,
  preview INTEGER NOT NULL DEFAULT 0,
  unsub_token TEXT NOT NULL UNIQUE,
  bounced_at TEXT,
  complained_at TEXT,
  updated_at TEXT NOT NULL
);

-- Raw provider webhook events, kept for support ("why did my mail stop?").
CREATE TABLE IF NOT EXISTS email_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  email TEXT NOT NULL,
  received_at TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_events_email ON email_events(email, received_at DESC);

-- Digest send ledger: claimed BEFORE the send attempt, so a re-run of the same
-- refresh/prediction never double-sends. ref_id is the race the digest is about.
CREATE TABLE IF NOT EXISTS email_sends (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  PRIMARY KEY (user_id, kind, ref_id)
);

-- Web Push (domains/notifications/repo.ts, WS-H). One row per browser push
-- endpoint (a user can have several devices). p256dh/auth are the subscriber's
-- public key material from the PushSubscription, required to encrypt payloads
-- per RFC 8291. followed_driver_id + kinds say what that device wants.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  followed_driver_id INTEGER,
  kinds TEXT NOT NULL,
  quiet_from_hour INTEGER,
  quiet_to_hour INTEGER,
  -- IANA zone from the device. Quiet hours are meaningless without it, and
  -- storing a fixed UTC offset instead would drift by an hour across DST.
  timezone TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Dedup ledger: the live Durable Object can restart and re-derive an alert it
-- already emitted, so the dispatcher records what each endpoint was sent and
-- refuses a repeat rather than trusting the feed to be exactly-once.
CREATE TABLE IF NOT EXISTS push_sends (
  endpoint TEXT NOT NULL,
  race_id INTEGER NOT NULL,
  dedup_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (endpoint, race_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_push_sends_race ON push_sends(race_id, sent_at);

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

/**
 * Data migrations that the idempotent DDL above cannot express. Each must be
 * safe to re-run on every boot, because that is exactly what happens.
 *
 * WS-J backfill: entitlements predating billing_grants have no grant rows, so
 * the first webhook to land afterwards would reproject from an empty ledger
 * and silently shorten a live season pass. Seeding one grant per existing
 * entitlement makes the projection agree with what the user already has.
 * `INSERT OR IGNORE` keeps re-runs no-ops: once a slot exists, the ledger —
 * not this backfill — owns it.
 */
const MIGRATIONS = `
INSERT OR IGNORE INTO billing_grants (user_id, channel, kind, pro_until, pro_source, updated_at)
SELECT user_id,
       CASE pro_source WHEN 'grant' THEN 'manual'
                       WHEN 'iap_subscription' THEN 'revenuecat'
                       WHEN 'iap_season_pass' THEN 'revenuecat'
                       ELSE 'stripe' END,
       CASE pro_source WHEN 'grant' THEN 'manual'
                       WHEN 'season_pass' THEN 'season_pass'
                       WHEN 'iap_season_pass' THEN 'season_pass'
                       ELSE 'subscription' END,
       pro_until, pro_source, updated_at
FROM entitlements;
`;

export function createDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // The server and the refresh child process share this file (WAL: one writer,
  // many readers); wait out a transient write lock instead of failing.
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  db.exec(MIGRATIONS);
  return db;
}

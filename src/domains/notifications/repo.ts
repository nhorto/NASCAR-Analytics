// Push subscription + dedup storage (WS-H). Policy lives in the service; this
// file only reads and writes rows.
import type { Database } from "bun:sqlite";
import type { PushAlertKind, PushSubscriptionRecord } from "./types.ts";

const COLS = `endpoint, user_id AS userId, p256dh, auth,
  followed_driver_id AS followedDriverId, kinds, quiet_from_hour AS quietFromHour,
  quiet_to_hour AS quietToHour, timezone, created_at AS createdAt,
  last_seen_at AS lastSeenAt, failure_count AS failureCount`;

interface Row extends Omit<PushSubscriptionRecord, "kinds"> {
  kinds: string;
}

/** Kinds are stored comma-separated; empty string means "none selected". */
function hydrate(row: Row | null): PushSubscriptionRecord | null {
  if (!row) return null;
  return {
    ...row,
    kinds: row.kinds === "" ? [] : (row.kinds.split(",") as PushAlertKind[]),
  };
}

export function upsertSubscription(
  db: Database,
  sub: PushSubscriptionRecord,
): void {
  db.query(
    `INSERT INTO push_subscriptions
       (endpoint, user_id, p256dh, auth, followed_driver_id, kinds,
        quiet_from_hour, quiet_to_hour, timezone, created_at, last_seen_at, failure_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       followed_driver_id = excluded.followed_driver_id,
       kinds = excluded.kinds,
       quiet_from_hour = excluded.quiet_from_hour,
       quiet_to_hour = excluded.quiet_to_hour,
       timezone = excluded.timezone,
       last_seen_at = excluded.last_seen_at,
       failure_count = 0`,
  ).run(
    sub.endpoint, sub.userId, sub.p256dh, sub.auth, sub.followedDriverId,
    sub.kinds.join(","), sub.quietFromHour, sub.quietToHour, sub.timezone,
    sub.createdAt, sub.lastSeenAt,
  );
}

export function subscriptionByEndpoint(db: Database, endpoint: string): PushSubscriptionRecord | null {
  return hydrate(
    db.query(`SELECT ${COLS} FROM push_subscriptions WHERE endpoint = ?`).get(endpoint) as Row | null,
  );
}

export function subscriptionsForUser(db: Database, userId: number): PushSubscriptionRecord[] {
  return (db.query(`SELECT ${COLS} FROM push_subscriptions WHERE user_id = ? ORDER BY created_at`)
    .all(userId) as Row[]).map((r) => hydrate(r)!);
}

/** Every live subscription — the dispatcher's candidate set. */
export function allSubscriptions(db: Database): PushSubscriptionRecord[] {
  return (db.query(`SELECT ${COLS} FROM push_subscriptions ORDER BY endpoint`).all() as Row[]).map(
    (r) => hydrate(r)!,
  );
}

export function deleteSubscription(db: Database, endpoint: string): boolean {
  return db.query(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint).changes === 1;
}

export function deleteSubscriptionsForUser(db: Database, userId: number): void {
  db.query(`DELETE FROM push_subscriptions WHERE user_id = ?`).run(userId);
}

export function recordFailure(db: Database, endpoint: string): number {
  db.query(`UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE endpoint = ?`)
    .run(endpoint);
  const row = db
    .query(`SELECT failure_count AS n FROM push_subscriptions WHERE endpoint = ?`)
    .get(endpoint) as { n: number } | null;
  return row?.n ?? 0;
}

export function recordSuccess(db: Database, endpoint: string, at: string): void {
  db.query(`UPDATE push_subscriptions SET failure_count = 0, last_seen_at = ? WHERE endpoint = ?`)
    .run(at, endpoint);
}

/** True the first time this (endpoint, race, alert) is claimed. */
export function claimSend(
  db: Database,
  endpoint: string,
  raceId: number,
  dedupKey: string,
  at: string,
): boolean {
  return (
    db
      .query(
        `INSERT OR IGNORE INTO push_sends (endpoint, race_id, dedup_key, sent_at) VALUES (?, ?, ?, ?)`,
      )
      .run(endpoint, raceId, dedupKey, at).changes === 1
  );
}

export function sendCountForRace(db: Database, raceId: number): number {
  return (db.query(`SELECT COUNT(*) AS n FROM push_sends WHERE race_id = ?`).get(raceId) as { n: number }).n;
}

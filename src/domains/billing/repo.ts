// Billing repo — owns the entitlements, stripe_events, billing_profiles,
// billing_grants, and revenuecat_* tables. WS-D shipped entitlement reads +
// manual grants; WS-E's Stripe webhook state machine and WS-J's RevenueCat
// one are the writers now — both go through billing_grants (see
// projectEntitlement), never `entitlements` directly.
import type { Database } from "bun:sqlite";
import type { BillingProfile, Entitlement, EntitlementGrant, GrantChannel, GrantKind, RevenueCatProfile } from "./types.ts";

export function entitlementFor(db: Database, userId: number): Entitlement | null {
  return db
    .query(
      `SELECT user_id AS userId, pro_until AS proUntil, pro_source AS proSource,
              updated_at AS updatedAt
       FROM entitlements WHERE user_id = ?`,
    )
    .get(userId) as Entitlement | null;
}

export function upsertEntitlement(db: Database, e: Entitlement): void {
  db.query(
    `INSERT INTO entitlements (user_id, pro_until, pro_source, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       pro_until = excluded.pro_until,
       pro_source = excluded.pro_source,
       updated_at = excluded.updated_at`,
  ).run(e.userId, e.proUntil, e.proSource, e.updatedAt);
}

export function deleteEntitlement(db: Database, userId: number): void {
  db.query(`DELETE FROM entitlements WHERE user_id = ?`).run(userId);
}

// --- billing_grants (per-channel entitlement ledger, WS-J) ---
//
// Each writer (Stripe, RevenueCat, the manual/tester path) owns exactly one
// (channel, kind) slot per user and only ever overwrites its own slot with a
// value computed from its own event's payload. `entitlements` is never
// written by a channel directly — it is always the projection of these rows
// (see projectEntitlement below), which is what makes "max across channels,
// no clobbering" true by construction rather than by convention.

export function grantsForUser(db: Database, userId: number): EntitlementGrant[] {
  return db
    .query(
      `SELECT user_id AS userId, channel, kind, pro_until AS proUntil,
              pro_source AS proSource, updated_at AS updatedAt
       FROM billing_grants WHERE user_id = ?`,
    )
    .all(userId) as EntitlementGrant[];
}

export function grantFor(
  db: Database,
  userId: number,
  channel: GrantChannel,
  kind: GrantKind,
): EntitlementGrant | null {
  return db
    .query(
      `SELECT user_id AS userId, channel, kind, pro_until AS proUntil,
              pro_source AS proSource, updated_at AS updatedAt
       FROM billing_grants WHERE user_id = ? AND channel = ? AND kind = ?`,
    )
    .get(userId, channel, kind) as EntitlementGrant | null;
}

export function upsertGrant(db: Database, g: EntitlementGrant): void {
  db.query(
    `INSERT INTO billing_grants (user_id, channel, kind, pro_until, pro_source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, channel, kind) DO UPDATE SET
       pro_until = excluded.pro_until,
       pro_source = excluded.pro_source,
       updated_at = excluded.updated_at`,
  ).run(g.userId, g.channel, g.kind, g.proUntil, g.proSource, g.updatedAt);
}

export function deleteGrantsForUser(db: Database, userId: number): void {
  db.query(`DELETE FROM billing_grants WHERE user_id = ?`).run(userId);
}

/**
 * Recompute `entitlements` from the max `pro_until` across a user's
 * surviving grants (numeric compare — grant rows can mix `toISOString()`'s
 * millisecond form with the fixed-format `SEASON_PASS_UNTIL`, and those don't
 * order correctly as raw strings). No grants left means no entitlement.
 */
export function projectEntitlement(db: Database, userId: number, now: Date): void {
  const grants = grantsForUser(db, userId);
  if (grants.length === 0) {
    deleteEntitlement(db, userId);
    return;
  }
  const winner = grants.reduce((best, g) =>
    Date.parse(g.proUntil) > Date.parse(best.proUntil) ? g : best,
  );
  upsertEntitlement(db, {
    userId,
    proUntil: winner.proUntil,
    proSource: winner.proSource,
    updatedAt: now.toISOString(),
  });
}

// --- Stripe webhook ledger (idempotency for at-least-once delivery) ---

/** Records the event id; false means it was already delivered (duplicate). */
export function recordStripeEvent(
  db: Database,
  e: { eventId: string; type: string; created: number },
  now: Date,
): boolean {
  const res = db
    .query(
      `INSERT OR IGNORE INTO stripe_events (event_id, type, created, received_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(e.eventId, e.type, e.created, now.toISOString());
  return res.changes > 0;
}

// --- billing profiles (the user ↔ Stripe mapping) ---

const PROFILE_COLUMNS = `user_id AS userId, customer_id AS customerId,
       subscription_id AS subscriptionId, subscription_status AS subscriptionStatus,
       cancel_at_period_end AS cancelAtPeriodEnd, current_period_end AS currentPeriodEnd,
       last_event_created AS lastEventCreated, updated_at AS updatedAt`;

function toProfile(row: unknown): BillingProfile | null {
  if (!row) return null;
  const r = row as Omit<BillingProfile, "cancelAtPeriodEnd"> & { cancelAtPeriodEnd: number };
  return { ...r, cancelAtPeriodEnd: r.cancelAtPeriodEnd !== 0 };
}

export function profileForUser(db: Database, userId: number): BillingProfile | null {
  return toProfile(
    db.query(`SELECT ${PROFILE_COLUMNS} FROM billing_profiles WHERE user_id = ?`).get(userId),
  );
}

export function profileForCustomer(db: Database, customerId: string): BillingProfile | null {
  return toProfile(
    db.query(`SELECT ${PROFILE_COLUMNS} FROM billing_profiles WHERE customer_id = ?`).get(customerId),
  );
}

export function upsertProfile(db: Database, p: BillingProfile): void {
  db.query(
    `INSERT INTO billing_profiles
       (user_id, customer_id, subscription_id, subscription_status,
        cancel_at_period_end, current_period_end, last_event_created, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       customer_id = excluded.customer_id,
       subscription_id = excluded.subscription_id,
       subscription_status = excluded.subscription_status,
       cancel_at_period_end = excluded.cancel_at_period_end,
       current_period_end = excluded.current_period_end,
       last_event_created = excluded.last_event_created,
       updated_at = excluded.updated_at`,
  ).run(
    p.userId,
    p.customerId,
    p.subscriptionId,
    p.subscriptionStatus,
    p.cancelAtPeriodEnd ? 1 : 0,
    p.currentPeriodEnd,
    p.lastEventCreated,
    p.updatedAt,
  );
}

// --- RevenueCat webhook ledger (idempotency for at-least-once delivery) ---

/** Records the event id; false means it was already delivered (duplicate). */
export function recordRevenueCatEvent(
  db: Database,
  e: { eventId: string; type: string; eventAt: number },
  now: Date,
): boolean {
  const res = db
    .query(
      `INSERT OR IGNORE INTO revenuecat_events (event_id, type, event_at, received_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(e.eventId, e.type, e.eventAt, now.toISOString());
  return res.changes > 0;
}

// --- revenuecat profiles (the user ↔ RevenueCat subscriber mapping) ---

const RC_PROFILE_COLUMNS = `user_id AS userId, app_user_id AS appUserId, store, environment,
       product_id AS productId, entitlement_status AS entitlementStatus,
       auto_renew AS autoRenew, expires_at AS expiresAt,
       last_event_at AS lastEventAt, updated_at AS updatedAt`;

function toRevenueCatProfile(row: unknown): RevenueCatProfile | null {
  if (!row) return null;
  const r = row as Omit<RevenueCatProfile, "autoRenew"> & { autoRenew: number };
  return { ...r, autoRenew: r.autoRenew !== 0 };
}

export function revenueCatProfileForUser(db: Database, userId: number): RevenueCatProfile | null {
  return toRevenueCatProfile(
    db.query(`SELECT ${RC_PROFILE_COLUMNS} FROM revenuecat_profiles WHERE user_id = ?`).get(userId),
  );
}

export function upsertRevenueCatProfile(db: Database, p: RevenueCatProfile): void {
  db.query(
    `INSERT INTO revenuecat_profiles
       (user_id, app_user_id, store, environment, product_id, entitlement_status,
        auto_renew, expires_at, last_event_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       app_user_id = excluded.app_user_id,
       store = excluded.store,
       environment = excluded.environment,
       product_id = excluded.product_id,
       entitlement_status = excluded.entitlement_status,
       auto_renew = excluded.auto_renew,
       expires_at = excluded.expires_at,
       last_event_at = excluded.last_event_at,
       updated_at = excluded.updated_at`,
  ).run(
    p.userId,
    p.appUserId,
    p.store,
    p.environment,
    p.productId,
    p.entitlementStatus,
    p.autoRenew ? 1 : 0,
    p.expiresAt,
    p.lastEventAt,
    p.updatedAt,
  );
}

// --- revenuecat aliases (app_user_id merges: anonymous → signed-in, TRANSFER) ---

export function userForAlias(db: Database, aliasId: string): number | null {
  const row = db.query(`SELECT user_id AS userId FROM revenuecat_aliases WHERE alias_id = ?`).get(aliasId) as
    | { userId: number }
    | null;
  return row?.userId ?? null;
}

export function recordRevenueCatAlias(db: Database, aliasId: string, userId: number): void {
  db.query(
    `INSERT INTO revenuecat_aliases (alias_id, user_id) VALUES (?, ?)
     ON CONFLICT (alias_id) DO UPDATE SET user_id = excluded.user_id`,
  ).run(aliasId, userId);
}

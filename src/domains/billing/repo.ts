// Billing repo — owns the entitlements, stripe_events, and billing_profiles
// tables. WS-D shipped entitlement reads + manual grants; WS-E's Stripe
// webhook state machine is the main writer.
import type { Database } from "bun:sqlite";
import type { BillingProfile, Entitlement } from "./types.ts";

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

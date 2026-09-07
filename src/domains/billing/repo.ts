// Billing repo — owns the entitlements table. WS-D ships reads + manual
// grants; WS-E's Stripe webhook state machine becomes the main writer.
import type { Database } from "bun:sqlite";
import type { Entitlement } from "./types.ts";

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

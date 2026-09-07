// Billing service — the entitlement model of spec §7: Pro is on iff
// `pro_until` is in the future. WS-D ships status reads, manual grants
// (testers/support), and the verified-email purchase guard; the Stripe
// webhook state machine arrives with WS-E.
import type { Providers } from "../../providers/index.ts";
import type { User } from "../accounts/types.ts";
import type { Entitlement, ProSource, ProStatus } from "./types.ts";
import * as repo from "./repo.ts";

type P = Pick<Providers, "db">;

export function proStatus(p: P, userId: number, now: Date): ProStatus {
  const e = repo.entitlementFor(p.db, userId);
  if (!e) return { pro: false, proUntil: null, proSource: null };
  const until = Date.parse(e.proUntil);
  const pro = Number.isFinite(until) && until > now.getTime();
  return { pro, proUntil: e.proUntil, proSource: e.proSource };
}

export function isPro(p: P, userId: number, now: Date): boolean {
  return proStatus(p, userId, now).pro;
}

/** Manual grant (or extension/downgrade) — the tester/support path. */
export function grantPro(
  p: P,
  userId: number,
  untilIso: string,
  source: ProSource,
  now: Date,
): Entitlement {
  if (!Number.isFinite(Date.parse(untilIso)))
    throw new Error(`grantPro: pro_until must be an ISO date, got "${untilIso}"`);
  const e: Entitlement = { userId, proUntil: untilIso, proSource: source, updatedAt: now.toISOString() };
  repo.upsertEntitlement(p.db, e);
  return e;
}

export function revoke(p: P, userId: number): void {
  repo.deleteEntitlement(p.db, userId);
}

/** Spec §6: email verification is required before any Pro purchase. */
export function canPurchase(user: User | null): { ok: boolean; reason: string | null } {
  if (!user) return { ok: false, reason: "Sign in first." };
  if (user.verifiedAt === null)
    return { ok: false, reason: "Verify your email address before upgrading." };
  return { ok: true, reason: null };
}

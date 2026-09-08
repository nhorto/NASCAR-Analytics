// Billing service — the entitlement model of spec §7: Pro is on iff
// `pro_until` is in the future. WS-D shipped status reads, manual grants
// (testers/support), and the verified-email purchase guard; WS-E adds the
// Stripe webhook state machine (`applyStripeEvent`), the only entitlement
// writer besides manual grants.
import type { Providers } from "../../providers/index.ts";
import type { User } from "../accounts/types.ts";
import type { BillingProfile, Entitlement, ProSource, ProStatus, WebhookOutcome } from "./types.ts";
import { ENTITLING_SUB_STATUSES, GRACE_DAYS, SEASON_PASS_UNTIL } from "./config.ts";
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

// --- Stripe webhook state machine (WS-E) ---
//
// Stripe delivers at-least-once and out of order. Three guards make that
// safe: the stripe_events ledger drops duplicate ids; last_event_created on
// the profile drops events older than the newest one applied; and every
// entitlement value is computed from the event's own payload (period ends),
// never from "now", so a replayed event recomputes the same answer.

export function profileFor(p: P, userId: number): BillingProfile | null {
  return repo.profileForUser(p.db, userId);
}

/** The subscription account-deletion must cancel at Stripe, if any (spec §6). */
export function cancelableSubscriptionId(p: P, userId: number): string | null {
  const profile = repo.profileForUser(p.db, userId);
  if (!profile?.subscriptionId) return null;
  const s = profile.subscriptionStatus;
  return s === "canceled" || s === "incomplete_expired" ? null : profile.subscriptionId;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function graceIso(periodEndSeconds: number): string {
  return new Date((periodEndSeconds + GRACE_DAYS * 86400) * 1000).toISOString();
}

/** Extend, never shrink: skips the write when a *different* source already
 *  entitles further out (a season pass must survive subscription churn). */
function extendEntitlement(p: P, userId: number, untilIso: string, source: ProSource, now: Date): void {
  const existing = repo.entitlementFor(p.db, userId);
  if (existing && existing.proSource !== source && Date.parse(existing.proUntil) >= Date.parse(untilIso))
    return;
  repo.upsertEntitlement(p.db, { userId, proUntil: untilIso, proSource: source, updatedAt: now.toISOString() });
}

/** Pull entitlement back to the event's own time, only for a matching source
 *  and only if a row exists (deleted accounts stay deleted). */
function clampEntitlement(p: P, userId: number, source: ProSource, atIso: string, now: Date): boolean {
  const existing = repo.entitlementFor(p.db, userId);
  if (!existing || existing.proSource !== source) return false;
  if (Date.parse(existing.proUntil) <= Date.parse(atIso)) return false;
  repo.upsertEntitlement(p.db, { userId, proUntil: atIso, proSource: source, updatedAt: now.toISOString() });
  return true;
}

/** The period a subscription invoice pays for ends at its line's period end. */
function invoicePeriodEnd(obj: Record<string, unknown>): number | null {
  const lines = (obj.lines as { data?: unknown[] } | undefined)?.data;
  const line = Array.isArray(lines) ? (lines[0] as Record<string, unknown> | undefined) : undefined;
  const linePeriod = line?.period as Record<string, unknown> | undefined;
  return num(linePeriod?.end) ?? num(obj.period_end);
}

/**
 * Feed one Stripe webhook event (parsed JSON, signature already verified)
 * through the state machine. Handles: checkout completion (subscription link
 * + season pass), subscription create/update/delete, invoice paid/failed,
 * and charge refunds. Anything else is recorded and ignored.
 */
export function applyStripeEvent(p: P, event: unknown, now: Date): WebhookOutcome {
  const evt = event as { id?: unknown; type?: unknown; created?: unknown; data?: { object?: unknown } };
  const eventId = str(evt?.id);
  const type = str(evt?.type);
  const created = num(evt?.created);
  const obj = evt?.data?.object;
  if (!eventId || !type || created === null || typeof obj !== "object" || obj === null)
    return { applied: false, action: "malformed_event" };
  const o = obj as Record<string, unknown>;

  if (!repo.recordStripeEvent(p.db, { eventId, type, created }, now))
    return { applied: false, action: "duplicate" };

  // Establishes the customer ↔ user link, so it cannot require one to exist.
  if (type === "checkout.session.completed") return applyCheckoutCompleted(p, o, created, now);

  const customerId = str(o.customer);
  const profile = customerId ? repo.profileForCustomer(p.db, customerId) : null;
  if (!profile) return { applied: false, action: "unknown_customer" };
  if (created < profile.lastEventCreated) return { applied: false, action: "stale_event" };
  profile.lastEventCreated = created;
  profile.updatedAt = now.toISOString();

  switch (type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      profile.subscriptionId = str(o.id) ?? profile.subscriptionId;
      profile.subscriptionStatus = str(o.status) ?? profile.subscriptionStatus;
      profile.cancelAtPeriodEnd = o.cancel_at_period_end === true;
      profile.currentPeriodEnd = num(o.current_period_end) ?? profile.currentPeriodEnd;
      repo.upsertProfile(p.db, profile);
      // Trial start and renewal are the same write: period end + grace. A
      // cancel-at-period-end keeps it — Pro runs until the period ends.
      if (
        (ENTITLING_SUB_STATUSES as readonly string[]).includes(profile.subscriptionStatus ?? "") &&
        profile.currentPeriodEnd !== null
      )
        extendEntitlement(p, profile.userId, graceIso(profile.currentPeriodEnd), "subscription", now);
      return { applied: true, action: "subscription_synced" };
    }

    case "customer.subscription.deleted": {
      profile.subscriptionStatus = "canceled";
      profile.cancelAtPeriodEnd = false;
      repo.upsertProfile(p.db, profile);
      // The subscription truly ended (period-end cancel reached, or retries
      // exhausted): Pro stops at the event's own time, grace included.
      clampEntitlement(p, profile.userId, "subscription", new Date(created * 1000).toISOString(), now);
      return { applied: true, action: "subscription_ended" };
    }

    case "invoice.paid": {
      const periodEnd = invoicePeriodEnd(o);
      // A real payment (not the $0 trial-start invoice) means trial→paid or
      // a renewal recovered from past_due: the banner can drop.
      if ((num(o.amount_paid) ?? 0) > 0) profile.subscriptionStatus = "active";
      if (periodEnd !== null) profile.currentPeriodEnd = periodEnd;
      repo.upsertProfile(p.db, profile);
      if (periodEnd !== null)
        extendEntitlement(p, profile.userId, graceIso(periodEnd), "subscription", now);
      return { applied: true, action: "invoice_paid" };
    }

    case "invoice.payment_failed": {
      // Spec §7: Pro stays on through the 3-day grace already baked into
      // pro_until; Stripe's smart retries run. We only surface the banner.
      profile.subscriptionStatus = "past_due";
      repo.upsertProfile(p.db, profile);
      return { applied: true, action: "payment_failed_grace" };
    }

    case "charge.refunded": {
      // Only a full refund revokes (partial refunds are support gestures).
      // A charge with an invoice is a subscription payment; without one it
      // is the season pass. Clamp the matching source only, so refunding a
      // stray subscription invoice cannot kill a season pass and vice versa.
      if (o.refunded !== true) return { applied: false, action: "refund_ignored" };
      repo.upsertProfile(p.db, profile);
      const source: ProSource = str(o.invoice) ? "subscription" : "season_pass";
      const revoked = clampEntitlement(
        p, profile.userId, source, new Date(created * 1000).toISOString(), now,
      );
      return revoked
        ? { applied: true, action: "refund_revoked" }
        : { applied: false, action: "refund_ignored" };
    }

    default:
      return { applied: false, action: "unhandled_type" };
  }
}

/** Checkout completed: link the customer to our user (client_reference_id is
 *  set when the session is created), and for mode=payment — the season pass,
 *  our only one-time product — write its fixed entitlement (spec §4/D5). */
function applyCheckoutCompleted(
  p: P,
  o: Record<string, unknown>,
  created: number,
  now: Date,
): WebhookOutcome {
  const customerId = str(o.customer);
  const userIdRaw = str(o.client_reference_id);
  const userId = userIdRaw !== null && /^\d+$/.test(userIdRaw) ? Number(userIdRaw) : null;
  if (!customerId || userId === null) return { applied: false, action: "missing_reference" };

  const existing = repo.profileForUser(p.db, userId);
  const profile: BillingProfile = existing ?? {
    userId,
    customerId,
    subscriptionId: null,
    subscriptionStatus: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    lastEventCreated: 0,
    updatedAt: now.toISOString(),
  };
  profile.customerId = customerId;
  profile.lastEventCreated = Math.max(profile.lastEventCreated, created);
  profile.updatedAt = now.toISOString();
  if (str(o.mode) === "subscription")
    profile.subscriptionId = str(o.subscription) ?? profile.subscriptionId;
  repo.upsertProfile(p.db, profile);

  if (str(o.mode) === "payment") {
    extendEntitlement(p, userId, SEASON_PASS_UNTIL, "season_pass", now);
    return { applied: true, action: "season_pass_granted" };
  }
  return { applied: true, action: "checkout_linked" };
}

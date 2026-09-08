// Billing service — the entitlement model of spec §7: Pro is on iff
// `pro_until` is in the future. WS-D shipped status reads, manual grants
// (testers/support), and the verified-email purchase guard; WS-E adds the
// Stripe webhook state machine (`applyStripeEvent`); WS-J adds the
// RevenueCat one (`applyRevenueCatEvent`) beside it. Stripe, RevenueCat, and
// manual grants are three independent writers that never touch `entitlements`
// directly — each owns one `billing_grants` (channel, kind) slot, and
// `entitlements` is always the projection of those rows (repo.projectEntitlement):
// the max `pro_until` across a user's surviving grants. That is the whole
// reconciliation rule — a channel can only ever help or hurt its own slot.
import type { Providers } from "../../providers/index.ts";
import type { User } from "../accounts/types.ts";
import type {
  BillingProfile,
  Entitlement,
  GrantChannel,
  GrantKind,
  ProSource,
  ProStatus,
  RevenueCatOutcome,
  RevenueCatProfile,
  WebhookOutcome,
} from "./types.ts";
import { ENTITLING_SUB_STATUSES, GRACE_DAYS, REVENUECAT_REFUND_REASONS, SEASON_PASS_UNTIL } from "./config.ts";
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

/** Writes one channel's (channel, kind) slot and reprojects `entitlements`
 *  from the surviving grants. Every writer below — Stripe, RevenueCat, and
 *  manual grants — funnels through this, so none of them can touch another
 *  channel's slot even by accident. */
function writeGrant(
  p: P,
  userId: number,
  channel: GrantChannel,
  kind: GrantKind,
  untilIso: string,
  source: ProSource,
  now: Date,
): void {
  repo.upsertGrant(p.db, { userId, channel, kind, proUntil: untilIso, proSource: source, updatedAt: now.toISOString() });
  repo.projectEntitlement(p.db, userId, now);
}

/**
 * Manual grant (or extension/downgrade) — the tester/support path. Always
 * writes the single `manual` slot (so a second call replaces the first, the
 * long-standing "grants overwrite" behavior), then returns the *effective*
 * entitlement — which may belong to a different channel, if that channel
 * already entitles further out. A support comp can never shrink a real
 * payer's Pro; `revoke` (below) is the tool for actually taking Pro away.
 */
export function grantPro(
  p: P,
  userId: number,
  untilIso: string,
  source: ProSource,
  now: Date,
): Entitlement {
  if (!Number.isFinite(Date.parse(untilIso)))
    throw new Error(`grantPro: pro_until must be an ISO date, got "${untilIso}"`);
  writeGrant(p, userId, "manual", "manual", untilIso, source, now);
  // A grant was just written, so a projected row is guaranteed to exist.
  return repo.entitlementFor(p.db, userId)!;
}

/** Removes every grant (all channels) and the projected entitlement — the
 *  tester `--revoke` path and account deletion both want a clean slate,
 *  which is also what makes deletion cancel a RevenueCat grant exactly like
 *  it already cancels a Stripe one (src/app/auth.ts): both are just grants
 *  in this table now. */
export function revoke(p: P, userId: number): void {
  repo.deleteGrantsForUser(p.db, userId);
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

/** Pull one channel's (channel, kind) grant back to the event's own time —
 *  only if that slot already has a grant and the new value actually reduces
 *  it (a refund of a slot we never wrote is a no-op signal, not a write).
 *  Because it targets one slot, refunding a subscription can never touch a
 *  season pass grant on the same channel, and never touches another
 *  channel's grant at all — no source-matching guard needed, the slot key
 *  already is the guard. */
function clampGrant(
  p: P,
  userId: number,
  channel: GrantChannel,
  kind: GrantKind,
  atIso: string,
  source: ProSource,
  now: Date,
): boolean {
  const existing = repo.grantFor(p.db, userId, channel, kind);
  if (!existing || Date.parse(existing.proUntil) <= Date.parse(atIso)) return false;
  writeGrant(p, userId, channel, kind, atIso, source, now);
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
        writeGrant(p, profile.userId, "stripe", "subscription", graceIso(profile.currentPeriodEnd), "subscription", now);
      return { applied: true, action: "subscription_synced" };
    }

    case "customer.subscription.deleted": {
      profile.subscriptionStatus = "canceled";
      profile.cancelAtPeriodEnd = false;
      repo.upsertProfile(p.db, profile);
      // The subscription truly ended (period-end cancel reached, or retries
      // exhausted): Pro stops at the event's own time, grace included.
      clampGrant(p, profile.userId, "stripe", "subscription", new Date(created * 1000).toISOString(), "subscription", now);
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
        writeGrant(p, profile.userId, "stripe", "subscription", graceIso(periodEnd), "subscription", now);
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
      const kind = str(o.invoice) ? "subscription" : "season_pass";
      const revoked = clampGrant(
        p, profile.userId, "stripe", kind, new Date(created * 1000).toISOString(), kind, now,
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
    writeGrant(p, userId, "stripe", "season_pass", SEASON_PASS_UNTIL, "season_pass", now);
    return { applied: true, action: "season_pass_granted" };
  }
  return { applied: true, action: "checkout_linked" };
}

// --- RevenueCat webhook state machine (WS-J) ---
//
// RevenueCat delivers at-least-once and out of order, same as Stripe, and
// the same three guards apply: the revenuecat_events ledger drops duplicate
// ids; last_event_at on the profile drops events older than the newest one
// applied; every grant value is computed from the event's own payload
// (`expiration_at_ms`), never from "now". The one thing that is genuinely
// different from Stripe: the app configures RevenueCat's SDK with our own
// numeric user id as its `app_user_id`, so most events carry the user id
// directly — there is no separate "checkout completed" linking step. The
// alias table only exists for the purchase-before-login edge case (an
// anonymous RevenueCat id later merged into a signed-in account).
//
// Only subscriptions (INITIAL_PURCHASE/RENEWAL/CANCELLATION/UNCANCELLATION/
// EXPIRATION/BILLING_ISSUE/PRODUCT_CHANGE) use the `subscription` slot;
// NON_RENEWING_PURCHASE — RevenueCat's shape for a one-time IAP — is the
// store's season pass and uses the `season_pass` slot, same fixed end date
// as Stripe's (spec §4/D5 is one product, sold on two channels).

function numericId(v: unknown): number | null {
  return typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Most events carry our user id directly as `app_user_id` (the app
 *  configures RevenueCat that way). The fallbacks cover a purchase that
 *  started anonymous and was later merged: a recorded alias, or — before
 *  that merge event has even arrived — RevenueCat still listing our real id
 *  among this subscriber's other known aliases. */
function resolveUserId(p: P, o: Record<string, unknown>): number | null {
  const direct = numericId(o.app_user_id);
  if (direct !== null) return direct;
  const appUserId = str(o.app_user_id);
  const viaAlias = appUserId ? repo.userForAlias(p.db, appUserId) : null;
  if (viaAlias !== null) return viaAlias;
  const aliases = Array.isArray(o.aliases) ? o.aliases : [];
  for (const a of aliases) {
    const n = numericId(a);
    if (n !== null) return n;
  }
  return null;
}

function blankRevenueCatProfile(userId: number, appUserId: string, now: Date): RevenueCatProfile {
  return {
    userId,
    appUserId,
    store: null,
    environment: null,
    productId: null,
    entitlementStatus: null,
    autoRenew: true,
    expiresAt: null,
    lastEventAt: 0,
    updatedAt: now.toISOString(),
  };
}

/** TRANSFER moves a subscriber's grant between app_user_ids (e.g. a purchase
 *  reassigned between accounts). Keeping this "straightforward" per plan: we
 *  record the old ids as aliases of the new owner so a late event addressed
 *  to one still resolves, but do not retroactively migrate grants already
 *  written under the old id. */
function applyRevenueCatTransfer(p: P, o: Record<string, unknown>): RevenueCatOutcome {
  const to = Array.isArray(o.transferred_to) ? o.transferred_to : [];
  let userId: number | null = null;
  for (const t of to) {
    const n = numericId(t);
    if (n !== null) {
      userId = n;
      break;
    }
  }
  if (userId === null) return { applied: false, action: "missing_reference" };
  const from = Array.isArray(o.transferred_from) ? o.transferred_from : [];
  for (const f of from) {
    const alias = str(f);
    if (alias && numericId(alias) === null) repo.recordRevenueCatAlias(p.db, alias, userId);
  }
  return { applied: true, action: "grant_transferred" };
}

/** SUBSCRIBER_ALIAS (older/deprecated but simple): records the mapping from
 *  a pre-login anonymous id to the signed-in user id it was merged into. */
function applyRevenueCatAlias(p: P, o: Record<string, unknown>): RevenueCatOutcome {
  const userId = resolveUserId(p, o);
  const oldAlias = str(o.original_app_user_id) ?? str(o.app_user_id);
  if (userId === null || !oldAlias) return { applied: false, action: "missing_reference" };
  repo.recordRevenueCatAlias(p.db, oldAlias, userId);
  return { applied: true, action: "alias_linked" };
}

/**
 * Feed one RevenueCat webhook event (parsed JSON, Authorization header
 * already verified) through the state machine. Handles: initial purchase,
 * renewal, the one-time (non-renewing) season pass, cancellation —
 * including the refund flavor Apple/Google report as a CANCELLATION with
 * `cancel_reason: CUSTOMER_SUPPORT`, plus a literal `REFUND` type some store
 * configurations send directly for one-time purchases — uncancellation,
 * expiration, billing issues, product changes, and alias/transfer. Anything
 * else is recorded and ignored.
 */
export function applyRevenueCatEvent(p: P, payload: unknown, now: Date): RevenueCatOutcome {
  const root = payload as { event?: unknown } | null;
  const o = (root && typeof root === "object" ? root.event : undefined) as Record<string, unknown> | undefined;
  const eventId = str(o?.id);
  const type = str(o?.type);
  const eventAt = num(o?.event_timestamp_ms);
  if (!o || !eventId || !type || eventAt === null) return { applied: false, action: "malformed_event" };

  if (!repo.recordRevenueCatEvent(p.db, { eventId, type, eventAt }, now))
    return { applied: false, action: "duplicate" };

  if (type === "TRANSFER") return applyRevenueCatTransfer(p, o);
  if (type === "SUBSCRIBER_ALIAS") return applyRevenueCatAlias(p, o);

  const userId = resolveUserId(p, o);
  if (userId === null) return { applied: false, action: "unknown_subscriber" };

  let profile = repo.revenueCatProfileForUser(p.db, userId);
  if (profile && eventAt < profile.lastEventAt) return { applied: false, action: "stale_event" };
  profile = profile ?? blankRevenueCatProfile(userId, str(o.app_user_id) ?? String(userId), now);
  profile.appUserId = str(o.app_user_id) ?? profile.appUserId;
  profile.store = str(o.store) ?? profile.store;
  profile.environment = str(o.environment) ?? profile.environment;
  profile.productId = str(o.product_id) ?? profile.productId;
  profile.lastEventAt = eventAt;
  profile.updatedAt = now.toISOString();

  const expiresAtMs = num(o.expiration_at_ms);
  const atIso = msToIso(eventAt);

  switch (type) {
    case "NON_RENEWING_PURCHASE": {
      profile.entitlementStatus = "active";
      profile.autoRenew = false;
      profile.expiresAt = null;
      repo.upsertRevenueCatProfile(p.db, profile);
      writeGrant(p, userId, "revenuecat", "season_pass", SEASON_PASS_UNTIL, "iap_season_pass", now);
      return { applied: true, action: "season_pass_granted" };
    }

    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE": {
      profile.entitlementStatus = "active";
      profile.autoRenew = true;
      profile.expiresAt = expiresAtMs;
      repo.upsertRevenueCatProfile(p.db, profile);
      if (expiresAtMs !== null)
        writeGrant(p, userId, "revenuecat", "subscription", msToIso(expiresAtMs), "iap_subscription", now);
      return {
        applied: true,
        action:
          type === "INITIAL_PURCHASE" ? "purchase_granted"
          : type === "RENEWAL" ? "subscription_renewed"
          : "product_changed",
      };
    }

    case "UNCANCELLATION": {
      profile.entitlementStatus = "active";
      profile.autoRenew = true;
      profile.expiresAt = expiresAtMs ?? profile.expiresAt;
      repo.upsertRevenueCatProfile(p.db, profile);
      if (expiresAtMs !== null)
        writeGrant(p, userId, "revenuecat", "subscription", msToIso(expiresAtMs), "iap_subscription", now);
      return { applied: true, action: "uncancellation_recorded" };
    }

    case "CANCELLATION": {
      const reason = str(o.cancel_reason);
      if (reason !== null && (REVENUECAT_REFUND_REASONS as readonly string[]).includes(reason)) {
        // Refunded through the store's support flow: Pro stops now, not at
        // the paid expiry.
        profile.entitlementStatus = "refunded";
        profile.autoRenew = false;
        repo.upsertRevenueCatProfile(p.db, profile);
        const revoked = clampGrant(p, userId, "revenuecat", "subscription", atIso, "iap_subscription", now);
        return revoked
          ? { applied: true, action: "refund_revoked" }
          : { applied: false, action: "refund_ignored" };
      }
      // Ordinary cancellation: auto-renew turned off, Pro keeps running to
      // the expiry already on file — EXPIRATION clamps it when that arrives.
      profile.entitlementStatus = "active";
      profile.autoRenew = false;
      repo.upsertRevenueCatProfile(p.db, profile);
      return { applied: true, action: "cancellation_recorded" };
    }

    case "REFUND": {
      // Some store configurations report a refunded one-time purchase as its
      // own event type rather than a CANCELLATION (which only applies to
      // auto-renewing subscriptions). Clamp the season pass slot only.
      profile.entitlementStatus = "refunded";
      repo.upsertRevenueCatProfile(p.db, profile);
      const revoked = clampGrant(p, userId, "revenuecat", "season_pass", atIso, "iap_season_pass", now);
      return revoked
        ? { applied: true, action: "refund_revoked" }
        : { applied: false, action: "refund_ignored" };
    }

    case "EXPIRATION": {
      profile.entitlementStatus = "expired";
      profile.autoRenew = false;
      repo.upsertRevenueCatProfile(p.db, profile);
      clampGrant(p, userId, "revenuecat", "subscription", expiresAtMs !== null ? msToIso(expiresAtMs) : atIso, "iap_subscription", now);
      return { applied: true, action: "subscription_expired" };
    }

    case "BILLING_ISSUE": {
      // Spec §7 grace equivalent: the store is retrying, RevenueCat's own
      // expiration_at_ms already reflects any grace window Apple/Google
      // grant, so we only surface the banner — no grant write, same as
      // Stripe's invoice.payment_failed.
      profile.entitlementStatus = "billing_issue";
      repo.upsertRevenueCatProfile(p.db, profile);
      return { applied: true, action: "billing_issue_grace" };
    }

    default:
      // Unlike the handled cases, this does not persist the profile — an
      // event type we don't process shouldn't advance last_event_at and
      // risk marking a real, later-processed event stale (same as Stripe's
      // unhandled_type: recorded in the ledger for dedup, otherwise inert).
      return { applied: false, action: "unhandled_type" };
  }
}

// RevenueCat webhook state machine (WS-J), driven with synthetic RevenueCat
// event payloads: the same acceptance shape as tests/billing.webhooks.test.ts
// (initial purchase, renewal, cancellation flavors, expiration, billing
// issue, product change, the one-time season pass, alias/transfer, duplicate
// and out-of-order delivery) plus the cross-channel reconciliation rule from
// the WS-J plan — Stripe and RevenueCat are independent writers, the max
// `pro_until` across channels wins, and neither can clobber the other's
// grant.
import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { billingService, billingConfig } from "../src/domains/billing/index.ts";
import { testDb } from "./seed.ts";

const NOW = new Date("2026-09-07T12:00:00Z");
const USER = 7;
const APP_USER_ID = String(USER);

const DAY_MS = 86_400_000;
const T0_MS = Date.parse("2026-09-10T00:00:00Z");
const EXP1_MS = T0_MS + 30 * DAY_MS;
const EXP2_MS = EXP1_MS + 30 * DAY_MS;

const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function rcEvent(
  type: string,
  fields: Record<string, unknown> = {},
  opts: { id?: string; atMs?: number } = {},
): unknown {
  seq += 1;
  return {
    api_version: "1.0",
    event: {
      id: opts.id ?? `rc_evt_${seq}`,
      type,
      app_user_id: APP_USER_ID,
      event_timestamp_ms: opts.atMs ?? T0_MS,
      store: "APP_STORE",
      environment: "PRODUCTION",
      product_id: "pro_monthly",
      ...fields,
    },
  };
}

/** A minimal synthetic Stripe season-pass checkout, for the cross-channel
 *  reconciliation tests — the exact shape tests/billing.webhooks.test.ts
 *  exercises in full; here it is only a second writer to reconcile against. */
let stripeSeq = 0;
function stripeSeasonPass(customer: string, created: number): unknown {
  stripeSeq += 1;
  return {
    id: `evt_stripe_${stripeSeq}`,
    type: "checkout.session.completed",
    created,
    data: { object: { mode: "payment", customer, client_reference_id: String(USER) } },
  };
}

function initialPurchase(p: { db: Database }, expirationAtMs = EXP1_MS, atMs = T0_MS) {
  return billingService.applyRevenueCatEvent(
    p,
    rcEvent("INITIAL_PURCHASE", { expiration_at_ms: expirationAtMs }, { atMs }),
    NOW,
  );
}

describe("initial purchase / renewal", () => {
  test("initial purchase grants Pro to its own expiration", () => {
    const p = { db: testDb() };
    const outcome = initialPurchase(p);
    expect(outcome).toEqual({ applied: true, action: "purchase_granted" });
    expect(billingService.proStatus(p, USER, NOW)).toEqual({
      pro: true,
      proUntil: iso(EXP1_MS),
      proSource: "iap_subscription",
    });
  });

  test("a renewal extends to the new expiration", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("RENEWAL", { expiration_at_ms: EXP2_MS }, { atMs: EXP1_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "subscription_renewed" });
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(EXP2_MS));
  });

  test("a product change re-grants to the new plan's expiration", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("PRODUCT_CHANGE", { product_id: "pro_annual", expiration_at_ms: EXP2_MS }, { atMs: T0_MS + DAY_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "product_changed" });
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(EXP2_MS));
  });
});

describe("season pass (NON_RENEWING_PURCHASE)", () => {
  test("a one-time purchase writes the fixed season end date", () => {
    const p = { db: testDb() };
    const outcome = billingService.applyRevenueCatEvent(p, rcEvent("NON_RENEWING_PURCHASE"), NOW);
    expect(outcome).toEqual({ applied: true, action: "season_pass_granted" });
    expect(billingService.proStatus(p, USER, NOW)).toEqual({
      pro: true,
      proUntil: billingConfig.SEASON_PASS_UNTIL,
      proSource: "iap_season_pass",
    });
  });

  test("subscription churn cannot shorten the store season pass (different slots)", () => {
    const p = { db: testDb() };
    billingService.applyRevenueCatEvent(p, rcEvent("NON_RENEWING_PURCHASE"), NOW);
    initialPurchase(p, EXP1_MS, T0_MS + DAY_MS);
    expect(billingService.proStatus(p, USER, NOW)).toMatchObject({
      proUntil: billingConfig.SEASON_PASS_UNTIL,
      proSource: "iap_season_pass",
    });
  });
});

describe("cancellation flavors", () => {
  test("an ordinary cancellation (auto-renew off) keeps Pro until the existing expiry", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("CANCELLATION", { cancel_reason: "UNSUBSCRIBE" }, { atMs: T0_MS + DAY_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "cancellation_recorded" });
    expect(billingService.proStatus(p, USER, NOW)).toEqual({
      pro: true,
      proUntil: iso(EXP1_MS),
      proSource: "iap_subscription",
    });
  });

  test("a CUSTOMER_SUPPORT cancellation is a refund: Pro stops at the event's own time", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    const cancelAt = T0_MS + 5 * DAY_MS;
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("CANCELLATION", { cancel_reason: "CUSTOMER_SUPPORT" }, { atMs: cancelAt }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "refund_revoked" });
    expect(billingService.isPro(p, USER, new Date(cancelAt + 1))).toBe(false);
    expect(billingService.isPro(p, USER, new Date(cancelAt - 1))).toBe(true);
  });

  test("a refund cancellation with no existing grant is a no-op signal", () => {
    const p = { db: testDb() };
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("CANCELLATION", { cancel_reason: "CUSTOMER_SUPPORT" }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "refund_ignored" });
  });

  test("uncancellation turns auto-renew back on and keeps the grant current", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    billingService.applyRevenueCatEvent(p, rcEvent("CANCELLATION", { cancel_reason: "UNSUBSCRIBE" }, { atMs: T0_MS + DAY_MS }), NOW);
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("UNCANCELLATION", { expiration_at_ms: EXP1_MS }, { atMs: T0_MS + 2 * DAY_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "uncancellation_recorded" });
    expect(billingService.proStatus(p, USER, NOW).pro).toBe(true);
  });
});

describe("expiration and billing issues", () => {
  test("expiration clamps Pro to the store's own expiration time", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    billingService.applyRevenueCatEvent(p, rcEvent("CANCELLATION", { cancel_reason: "UNSUBSCRIBE" }, { atMs: T0_MS + DAY_MS }), NOW);
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("EXPIRATION", { expiration_at_ms: EXP1_MS }, { atMs: EXP1_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "subscription_expired" });
    expect(billingService.isPro(p, USER, new Date(EXP1_MS + 1))).toBe(false);
  });

  test("a billing issue only updates status; the grant is untouched (grace lives in expiration_at_ms)", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("BILLING_ISSUE", {}, { atMs: T0_MS + DAY_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "billing_issue_grace" });
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(EXP1_MS));
  });
});

describe("refund of a one-time purchase", () => {
  test("a REFUND event clamps the season pass slot only", () => {
    const p = { db: testDb() };
    billingService.applyRevenueCatEvent(p, rcEvent("NON_RENEWING_PURCHASE"), NOW);
    const refundAt = T0_MS + 3 * DAY_MS;
    const outcome = billingService.applyRevenueCatEvent(p, rcEvent("REFUND", {}, { atMs: refundAt }), NOW);
    expect(outcome).toEqual({ applied: true, action: "refund_revoked" });
    expect(billingService.isPro(p, USER, new Date(refundAt + 1))).toBe(false);
  });

  test("refunding a subscription cannot be confused with refunding a season pass", () => {
    const p = { db: testDb() };
    initialPurchase(p); // subscription only, no season pass grant
    const outcome = billingService.applyRevenueCatEvent(p, rcEvent("REFUND", {}, { atMs: T0_MS + DAY_MS }), NOW);
    expect(outcome).toEqual({ applied: false, action: "refund_ignored" });
    expect(billingService.proStatus(p, USER, NOW).proSource).toBe("iap_subscription");
  });
});

describe("duplicate delivery", () => {
  test("the same event id applies once; the replay is a recorded no-op", () => {
    const p = { db: testDb() };
    const event = rcEvent("INITIAL_PURCHASE", { expiration_at_ms: EXP1_MS }, { id: "rc_evt_dup" });
    expect(billingService.applyRevenueCatEvent(p, event, NOW).applied).toBe(true);
    expect(billingService.applyRevenueCatEvent(p, event, NOW)).toEqual({ applied: false, action: "duplicate" });
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(EXP1_MS));
  });
});

describe("out-of-order delivery", () => {
  test("an event older than the newest applied one is skipped", () => {
    const p = { db: testDb() };
    billingService.applyRevenueCatEvent(p, rcEvent("RENEWAL", { expiration_at_ms: EXP2_MS }, { atMs: EXP1_MS }), NOW);
    const stale = billingService.applyRevenueCatEvent(
      p,
      rcEvent("INITIAL_PURCHASE", { expiration_at_ms: EXP1_MS }, { atMs: T0_MS }),
      NOW,
    );
    expect(stale).toEqual({ applied: false, action: "stale_event" });
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(EXP2_MS));
  });
});

describe("reject paths", () => {
  test("an app_user_id we cannot attribute to a user is acknowledged but ignored", () => {
    const p = { db: testDb() };
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("INITIAL_PURCHASE", { app_user_id: "anon_stranger", expiration_at_ms: EXP1_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "unknown_subscriber" });
  });

  test("unhandled event types are recorded and ignored", () => {
    const p = { db: testDb() };
    initialPurchase(p);
    const outcome = billingService.applyRevenueCatEvent(p, rcEvent("SUBSCRIPTION_PAUSED"), NOW);
    expect(outcome).toEqual({ applied: false, action: "unhandled_type" });
  });

  test("malformed events are refused before touching state", () => {
    const p = { db: testDb() };
    for (const bad of [
      null,
      {},
      { event: {} },
      { event: { id: "x" } },
      { event: { id: "x", type: "INITIAL_PURCHASE" } },
    ])
      expect(billingService.applyRevenueCatEvent(p, bad, NOW)).toEqual({ applied: false, action: "malformed_event" });
  });
});

describe("alias and transfer", () => {
  test("SUBSCRIBER_ALIAS links an anonymous purchase's id to the signed-in account", () => {
    const p = { db: testDb() };
    const ALIAS = "anon_abc123";
    const aliasOutcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("SUBSCRIBER_ALIAS", { app_user_id: ALIAS, original_app_user_id: ALIAS, aliases: [ALIAS, APP_USER_ID] }, { atMs: T0_MS }),
      NOW,
    );
    expect(aliasOutcome).toEqual({ applied: true, action: "alias_linked" });
    // A later event addressed to the old anonymous id now resolves.
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("INITIAL_PURCHASE", { app_user_id: ALIAS, expiration_at_ms: EXP1_MS }, { atMs: T0_MS + DAY_MS }),
      NOW,
    );
    expect(outcome.applied).toBe(true);
    expect(billingService.proStatus(p, USER, NOW).pro).toBe(true);
  });

  test("TRANSFER records the old id as an alias of the new owner", () => {
    const p = { db: testDb() };
    const OLD = "anon_old1";
    const transferOutcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("TRANSFER", { transferred_from: [OLD], transferred_to: [APP_USER_ID] }, { atMs: T0_MS }),
      NOW,
    );
    expect(transferOutcome).toEqual({ applied: true, action: "grant_transferred" });
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("INITIAL_PURCHASE", { app_user_id: OLD, expiration_at_ms: EXP1_MS }, { atMs: T0_MS + DAY_MS }),
      NOW,
    );
    expect(outcome.applied).toBe(true);
    expect(billingService.proStatus(p, USER, NOW).pro).toBe(true);
  });

  test("a TRANSFER with no attributable new owner is a missing reference", () => {
    const p = { db: testDb() };
    const outcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("TRANSFER", { transferred_from: ["anon_a"], transferred_to: ["anon_b"] }, { atMs: T0_MS }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "missing_reference" });
  });
});

describe("cross-channel reconciliation (Stripe + RevenueCat, WS-J D21)", () => {
  const CUSTOMER = "cus_rc_test";

  test("the later-expiring channel wins the projection, and a refund on the other channel cannot touch it", () => {
    const p = { db: testDb() };
    // Stripe season pass: far in the future.
    billingService.applyStripeEvent(p, stripeSeasonPass(CUSTOMER, Math.floor(T0_MS / 1000)), NOW);
    // RevenueCat subscription: sooner.
    initialPurchase(p, EXP1_MS, T0_MS + DAY_MS);
    expect(billingService.proStatus(p, USER, NOW)).toMatchObject({
      proSource: "season_pass",
      proUntil: billingConfig.SEASON_PASS_UNTIL,
    });

    // Refunding the RevenueCat subscription only clamps its own slot.
    const refundOutcome = billingService.applyRevenueCatEvent(
      p,
      rcEvent("CANCELLATION", { cancel_reason: "CUSTOMER_SUPPORT" }, { atMs: T0_MS + 2 * DAY_MS }),
      NOW,
    );
    expect(refundOutcome).toEqual({ applied: true, action: "refund_revoked" });
    expect(billingService.proStatus(p, USER, NOW)).toMatchObject({
      pro: true,
      proSource: "season_pass",
      proUntil: billingConfig.SEASON_PASS_UNTIL,
    });
  });

  test("a RevenueCat grant outlasting the Stripe season pass wins, and a Stripe refund cannot touch it", () => {
    const p = { db: testDb() };
    const farFuture = Date.parse("2030-01-01T00:00:00Z");
    initialPurchase(p, farFuture, T0_MS);
    billingService.applyStripeEvent(p, stripeSeasonPass(CUSTOMER, Math.floor(T0_MS / 1000) + 1), NOW);
    expect(billingService.proStatus(p, USER, NOW)).toMatchObject({
      proSource: "iap_subscription",
      proUntil: new Date(farFuture).toISOString(),
    });

    // Refunding the Stripe season pass only clamps its own slot.
    const refundOutcome = billingService.applyStripeEvent(
      p,
      {
        id: "evt_stripe_refund",
        type: "charge.refunded",
        created: Math.floor(T0_MS / 1000) + 2,
        data: { object: { customer: CUSTOMER, refunded: true } },
      },
      NOW,
    );
    expect(refundOutcome).toEqual({ applied: true, action: "refund_revoked" });
    expect(billingService.proStatus(p, USER, NOW)).toMatchObject({
      pro: true,
      proSource: "iap_subscription",
      proUntil: new Date(farFuture).toISOString(),
    });
  });

  test("account deletion (revoke) drops the grant from every channel", () => {
    const p = { db: testDb() };
    billingService.applyStripeEvent(p, stripeSeasonPass(CUSTOMER, Math.floor(T0_MS / 1000)), NOW);
    initialPurchase(p, EXP1_MS, T0_MS + DAY_MS);
    expect(billingService.proStatus(p, USER, NOW).pro).toBe(true);

    billingService.revoke(p, USER);
    expect(billingService.proStatus(p, USER, NOW)).toEqual({ pro: false, proUntil: null, proSource: null });
  });
});

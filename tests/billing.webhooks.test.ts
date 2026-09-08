// Stripe webhook state machine (WS-E), driven with synthetic Stripe event
// payloads: the eight acceptance scenarios from the launch plan — trial
// start, trial→paid, payment failed→grace→off, cancel at period end, season
// pass purchase, refund, duplicate delivery, out-of-order delivery — plus the
// reject paths (malformed, unknown customer, unhandled type).
import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { billingService, billingConfig } from "../src/domains/billing/index.ts";
import { testDb } from "./seed.ts";

const NOW = new Date("2026-09-07T12:00:00Z");
const USER = 7;
const CUSTOMER = "cus_test1";
const SUB = "sub_test1";

const DAY = 86_400;
const T0 = 1_789_000_000; // checkout completes (2026-09-10, just after NOW)
const TRIAL_END = T0 + 7 * DAY;
const PERIOD_END = TRIAL_END + 30 * DAY;
const GRACE_S = billingConfig.GRACE_DAYS * DAY;

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
const at = (unixSeconds: number) => new Date(unixSeconds * 1000);

let seq = 0;
function evt(
  type: string,
  object: Record<string, unknown>,
  opts: { id?: string; created?: number } = {},
): Record<string, unknown> {
  seq += 1;
  return {
    id: opts.id ?? `evt_${seq}`,
    type,
    created: opts.created ?? T0,
    data: { object },
  };
}

function checkoutCompleted(mode: "subscription" | "payment", created: number) {
  return evt(
    "checkout.session.completed",
    {
      mode,
      customer: CUSTOMER,
      client_reference_id: String(USER),
      ...(mode === "subscription" ? { subscription: SUB } : {}),
    },
    { created },
  );
}

function subscriptionEvent(
  type: "created" | "updated" | "deleted",
  created: number,
  fields: Record<string, unknown> = {},
) {
  return evt(
    `customer.subscription.${type}`,
    { id: SUB, customer: CUSTOMER, ...fields },
    { created },
  );
}

function invoiceEvent(
  type: "paid" | "payment_failed",
  created: number,
  fields: Record<string, unknown> = {},
) {
  return evt(`invoice.${type}`, { customer: CUSTOMER, ...fields }, { created });
}

/** A subscription mid-trial: checkout linked + trialing subscription. */
function trialingState(p: { db: Database }): void {
  billingService.applyStripeEvent(p, checkoutCompleted("subscription", T0), NOW);
  billingService.applyStripeEvent(
    p,
    subscriptionEvent("created", T0 + 1, { status: "trialing", current_period_end: TRIAL_END }),
    NOW,
  );
}

describe("trial start", () => {
  test("checkout links the customer; the trialing subscription writes trial end + grace", () => {
    const p = { db: testDb() };
    const link = billingService.applyStripeEvent(p, checkoutCompleted("subscription", T0), NOW);
    expect(link).toEqual({ applied: true, action: "checkout_linked" });

    const profile = billingService.profileFor(p, USER);
    expect(profile?.customerId).toBe(CUSTOMER);
    expect(profile?.subscriptionId).toBe(SUB);

    const sync = billingService.applyStripeEvent(
      p,
      subscriptionEvent("created", T0 + 1, { status: "trialing", current_period_end: TRIAL_END }),
      NOW,
    );
    expect(sync).toEqual({ applied: true, action: "subscription_synced" });
    expect(billingService.proStatus(p, USER, NOW)).toEqual({
      pro: true,
      proUntil: iso(TRIAL_END + GRACE_S),
      proSource: "subscription",
    });
  });

  test("checkout without a client_reference_id cannot be attributed", () => {
    const p = { db: testDb() };
    const outcome = billingService.applyStripeEvent(
      p,
      evt("checkout.session.completed", { mode: "subscription", customer: CUSTOMER }, { created: T0 }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "missing_reference" });
    expect(billingService.profileFor(p, USER)).toBeNull();
  });
});

describe("trial → paid", () => {
  test("the first real invoice extends to its period end + grace and marks the sub active", () => {
    const p = { db: testDb() };
    trialingState(p);
    const outcome = billingService.applyStripeEvent(
      p,
      invoiceEvent("paid", TRIAL_END, {
        amount_paid: 999,
        billing_reason: "subscription_cycle",
        lines: { data: [{ period: { end: PERIOD_END } }] },
      }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "invoice_paid" });
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(PERIOD_END + GRACE_S));
    expect(billingService.profileFor(p, USER)?.subscriptionStatus).toBe("active");
  });

  test("the $0 trial-start invoice does not flip the status to active", () => {
    const p = { db: testDb() };
    trialingState(p);
    billingService.applyStripeEvent(
      p,
      invoiceEvent("paid", T0 + 2, {
        amount_paid: 0,
        billing_reason: "subscription_create",
        lines: { data: [{ period: { end: TRIAL_END } }] },
      }),
      NOW,
    );
    expect(billingService.profileFor(p, USER)?.subscriptionStatus).toBe("trialing");
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(TRIAL_END + GRACE_S));
  });
});

describe("payment failed → grace → off", () => {
  test("a failed renewal keeps Pro exactly through the grace window", () => {
    const p = { db: testDb() };
    trialingState(p);
    billingService.applyStripeEvent(
      p,
      invoiceEvent("paid", TRIAL_END, { amount_paid: 999, lines: { data: [{ period: { end: PERIOD_END } }] } }),
      NOW,
    );
    const outcome = billingService.applyStripeEvent(
      p,
      invoiceEvent("payment_failed", PERIOD_END, { amount_due: 999 }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "payment_failed_grace" });
    expect(billingService.profileFor(p, USER)?.subscriptionStatus).toBe("past_due");
    // Grace: still Pro two days in, off after the third day passes.
    expect(billingService.isPro(p, USER, at(PERIOD_END + 2 * DAY))).toBe(true);
    expect(billingService.isPro(p, USER, at(PERIOD_END + GRACE_S + 1))).toBe(false);
  });

  test("retries exhausted: subscription.deleted ends the subscription state", () => {
    const p = { db: testDb() };
    trialingState(p);
    billingService.applyStripeEvent(
      p,
      invoiceEvent("paid", TRIAL_END, { amount_paid: 999, lines: { data: [{ period: { end: PERIOD_END } }] } }),
      NOW,
    );
    billingService.applyStripeEvent(p, invoiceEvent("payment_failed", PERIOD_END, {}), NOW);
    const outcome = billingService.applyStripeEvent(
      p,
      subscriptionEvent("deleted", PERIOD_END + 14 * DAY, { status: "canceled" }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "subscription_ended" });
    expect(billingService.profileFor(p, USER)?.subscriptionStatus).toBe("canceled");
    // Entitlement had already lapsed (period end + grace < deletion time).
    expect(billingService.proStatus(p, USER, at(PERIOD_END + 14 * DAY)).pro).toBe(false);
  });
});

describe("cancel at period end", () => {
  test("cancelling keeps Pro until the period ends; deletion cuts the grace tail", () => {
    const p = { db: testDb() };
    trialingState(p);
    billingService.applyStripeEvent(
      p,
      invoiceEvent("paid", TRIAL_END, { amount_paid: 999, lines: { data: [{ period: { end: PERIOD_END } }] } }),
      NOW,
    );
    billingService.applyStripeEvent(
      p,
      subscriptionEvent("updated", TRIAL_END + DAY, {
        status: "active",
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
      }),
      NOW,
    );
    expect(billingService.profileFor(p, USER)?.cancelAtPeriodEnd).toBe(true);
    expect(billingService.isPro(p, USER, at(PERIOD_END - DAY))).toBe(true);

    // Stripe fires deleted at the period end; no failed-payment grace applies.
    billingService.applyStripeEvent(p, subscriptionEvent("deleted", PERIOD_END, { status: "canceled" }), NOW);
    expect(billingService.proStatus(p, USER, at(PERIOD_END - 1))).toMatchObject({ pro: true });
    expect(billingService.isPro(p, USER, at(PERIOD_END + 1))).toBe(false);
    expect(billingService.cancelableSubscriptionId(p, USER)).toBeNull();
  });
});

describe("season pass", () => {
  test("a mode=payment checkout writes the fixed season end date", () => {
    const p = { db: testDb() };
    const outcome = billingService.applyStripeEvent(p, checkoutCompleted("payment", T0), NOW);
    expect(outcome).toEqual({ applied: true, action: "season_pass_granted" });
    expect(billingService.proStatus(p, USER, NOW)).toEqual({
      pro: true,
      proUntil: billingConfig.SEASON_PASS_UNTIL,
      proSource: "season_pass",
    });
  });

  test("subscription churn cannot shorten a season pass", () => {
    const p = { db: testDb() };
    billingService.applyStripeEvent(p, checkoutCompleted("payment", T0), NOW);
    billingService.applyStripeEvent(
      p,
      subscriptionEvent("created", T0 + 1, { status: "trialing", current_period_end: TRIAL_END }),
      NOW,
    );
    // The pass ends later than trial end + grace, so it wins.
    expect(billingService.proStatus(p, USER, NOW)).toMatchObject({
      proUntil: billingConfig.SEASON_PASS_UNTIL,
      proSource: "season_pass",
    });
  });
});

describe("refunds", () => {
  test("a full season-pass refund revokes the pass at the event's time", () => {
    const p = { db: testDb() };
    billingService.applyStripeEvent(p, checkoutCompleted("payment", T0), NOW);
    const outcome = billingService.applyStripeEvent(
      p,
      evt("charge.refunded", { customer: CUSTOMER, refunded: true, amount_refunded: 6900 }, { created: T0 + 5 * DAY }),
      NOW,
    );
    expect(outcome).toEqual({ applied: true, action: "refund_revoked" });
    expect(billingService.isPro(p, USER, at(T0 + 5 * DAY + 1))).toBe(false);
  });

  test("a partial refund changes nothing", () => {
    const p = { db: testDb() };
    billingService.applyStripeEvent(p, checkoutCompleted("payment", T0), NOW);
    const outcome = billingService.applyStripeEvent(
      p,
      evt("charge.refunded", { customer: CUSTOMER, refunded: false, amount_refunded: 100 }, { created: T0 + 5 * DAY }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "refund_ignored" });
    expect(billingService.proStatus(p, USER, NOW).pro).toBe(true);
  });

  test("refunding a subscription invoice cannot kill a season pass (source must match)", () => {
    const p = { db: testDb() };
    billingService.applyStripeEvent(p, checkoutCompleted("payment", T0), NOW);
    const outcome = billingService.applyStripeEvent(
      p,
      evt("charge.refunded", { customer: CUSTOMER, refunded: true, invoice: "in_1" }, { created: T0 + 5 * DAY }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "refund_ignored" });
    expect(billingService.proStatus(p, USER, NOW).proSource).toBe("season_pass");
  });
});

describe("duplicate delivery", () => {
  test("the same event id applies once; the replay is a recorded no-op", () => {
    const p = { db: testDb() };
    const event = checkoutCompleted("payment", T0);
    expect(billingService.applyStripeEvent(p, event, NOW).applied).toBe(true);
    expect(billingService.applyStripeEvent(p, event, NOW)).toEqual({
      applied: false,
      action: "duplicate",
    });
    expect(billingService.proStatus(p, USER, NOW).pro).toBe(true);
  });
});

describe("out-of-order delivery", () => {
  test("an event older than the newest applied one is skipped", () => {
    const p = { db: testDb() };
    trialingState(p);
    billingService.applyStripeEvent(
      p,
      invoiceEvent("paid", TRIAL_END, { amount_paid: 999, lines: { data: [{ period: { end: PERIOD_END } }] } }),
      NOW,
    );
    // A stale subscription snapshot from mid-trial arrives late: skipped, the
    // entitlement keeps the paid period.
    const stale = billingService.applyStripeEvent(
      p,
      subscriptionEvent("updated", T0 + 2, { status: "trialing", current_period_end: TRIAL_END }),
      NOW,
    );
    expect(stale).toEqual({ applied: false, action: "stale_event" });
    expect(billingService.proStatus(p, USER, NOW).proUntil).toBe(iso(PERIOD_END + GRACE_S));
    expect(billingService.profileFor(p, USER)?.subscriptionStatus).toBe("active");
  });
});

describe("reject paths", () => {
  test("events for a customer we never linked are acknowledged but ignored", () => {
    const p = { db: testDb() };
    const outcome = billingService.applyStripeEvent(
      p,
      evt("customer.subscription.updated", { id: "sub_x", customer: "cus_stranger", status: "active" }, { created: T0 }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "unknown_customer" });
  });

  test("unhandled event types are recorded and ignored", () => {
    const p = { db: testDb() };
    trialingState(p);
    const outcome = billingService.applyStripeEvent(
      p,
      evt("customer.updated", { customer: CUSTOMER }, { created: T0 + 10 }),
      NOW,
    );
    expect(outcome).toEqual({ applied: false, action: "unhandled_type" });
  });

  test("malformed events are refused before touching state", () => {
    const p = { db: testDb() };
    for (const bad of [null, {}, { id: "evt_1" }, { id: "evt_1", type: "x", created: "later" }])
      expect(billingService.applyStripeEvent(p, bad, NOW)).toEqual({
        applied: false,
        action: "malformed_event",
      });
  });
});

describe("cancelableSubscriptionId (account deletion)", () => {
  test("null with no profile, the live id mid-subscription, null once canceled", () => {
    const p = { db: testDb() };
    expect(billingService.cancelableSubscriptionId(p, USER)).toBeNull();
    trialingState(p);
    expect(billingService.cancelableSubscriptionId(p, USER)).toBe(SUB);
    billingService.applyStripeEvent(p, subscriptionEvent("deleted", T0 + 2, { status: "canceled" }), NOW);
    expect(billingService.cancelableSubscriptionId(p, USER)).toBeNull();
  });
});

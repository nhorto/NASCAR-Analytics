// Stripe provider (WS-E): signature verification negative cases — forged,
// tampered, replayed, malformed — and the cancel-subscription client over an
// injected fetch.
import { describe, expect, test } from "bun:test";
import {
  createNullStripe,
  createStripeClient,
  signStripePayload,
  verifyStripeSignature,
} from "../src/providers/stripe.ts";

const SECRET = "whsec_test_secret";
const NOW_S = 1_789_000_000;
const BODY = JSON.stringify({ id: "evt_1", type: "invoice.paid" });

function header(body: string, ts: number = NOW_S, secret: string = SECRET): string {
  return `t=${ts},v1=${signStripePayload(secret, String(ts), body)}`;
}

describe("verifyStripeSignature", () => {
  test("a correctly signed payload verifies", () => {
    expect(
      verifyStripeSignature({ secret: SECRET, header: header(BODY), body: BODY, nowSeconds: NOW_S }),
    ).toEqual({ ok: true });
  });

  test("any one matching v1 passes (secret roll ships two signatures)", () => {
    const h = `t=${NOW_S},v1=${"0".repeat(64)},v1=${signStripePayload(SECRET, String(NOW_S), BODY)}`;
    expect(verifyStripeSignature({ secret: SECRET, header: h, body: BODY, nowSeconds: NOW_S }).ok).toBe(true);
  });

  test("a tampered body is rejected", () => {
    const verdict = verifyStripeSignature({
      secret: SECRET,
      header: header(BODY),
      body: BODY.replace("invoice.paid", "invoice.payment_failed"),
      nowSeconds: NOW_S,
    });
    expect(verdict).toEqual({ ok: false, reason: "signature mismatch" });
  });

  test("a wrong secret is rejected", () => {
    const verdict = verifyStripeSignature({
      secret: SECRET,
      header: header(BODY, NOW_S, "whsec_other"),
      body: BODY,
      nowSeconds: NOW_S,
    });
    expect(verdict).toEqual({ ok: false, reason: "signature mismatch" });
  });

  test("a replay outside the tolerance window is rejected, inside passes", () => {
    const old = NOW_S - 301;
    expect(
      verifyStripeSignature({ secret: SECRET, header: header(BODY, old), body: BODY, nowSeconds: NOW_S }),
    ).toEqual({ ok: false, reason: "timestamp outside tolerance" });
    expect(
      verifyStripeSignature({ secret: SECRET, header: header(BODY, NOW_S - 299), body: BODY, nowSeconds: NOW_S }).ok,
    ).toBe(true);
  });

  test("missing or malformed headers are rejected before any comparison", () => {
    const cases: [string | null, string][] = [
      [null, "missing signature header"],
      ["", "missing signature header"],
      ["v1=abc", "malformed signature header"],
      [`t=${NOW_S}`, "malformed signature header"],
      ["t=soon,v1=abc", "malformed timestamp"],
    ];
    for (const [h, reason] of cases)
      expect(verifyStripeSignature({ secret: SECRET, header: h, body: BODY, nowSeconds: NOW_S })).toEqual({
        ok: false,
        reason,
      });
  });
});

describe("cancelSubscription", () => {
  test("issues an authorized DELETE against the subscription", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const client = createStripeClient({
      secretKey: "sk_test_123",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
        });
        return new Response(JSON.stringify({ id: "sub_1", status: "canceled" }), { status: 200 });
      }) as typeof fetch,
    });
    expect(await client.cancelSubscription("sub_1")).toEqual({ ok: true, detail: "canceled sub_1" });
    expect(calls).toEqual([
      {
        url: "https://api.stripe.com/v1/subscriptions/sub_1",
        method: "DELETE",
        auth: "Bearer sk_test_123",
      },
    ]);
  });

  test("an already-gone subscription (404) counts as success", async () => {
    const client = createStripeClient({
      secretKey: "sk_test_123",
      fetchImpl: (async (_url: string | URL | Request) => new Response("{}", { status: 404 })) as typeof fetch,
    });
    expect((await client.cancelSubscription("sub_gone")).ok).toBe(true);
  });

  test("API errors and transport failures report not-ok with the detail", async () => {
    const apiError = createStripeClient({
      secretKey: "sk",
      fetchImpl: (async (_url: string | URL | Request) => new Response("rate limited", { status: 429 })) as typeof fetch,
    });
    expect(await apiError.cancelSubscription("sub_1")).toEqual({
      ok: false,
      detail: "stripe HTTP 429: rate limited",
    });

    const transport = createStripeClient({
      secretKey: "sk",
      fetchImpl: (async (_url: string | URL | Request): Promise<Response> => {
        throw new Error("ECONNRESET");
      }) as typeof fetch,
    });
    const res = await transport.cancelSubscription("sub_1");
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("ECONNRESET");
  });

  test("the null client reports unconfigured but succeeds (nothing exists to cancel)", async () => {
    const client = createNullStripe();
    expect(client.configured).toBe(false);
    expect((await client.cancelSubscription("sub_1")).ok).toBe(true);
  });
});

describe("checkout + portal session creation", () => {
  /** Captures exactly what would go over the wire to Stripe. */
  function capturing(response: Response) {
    const calls: Array<{ url: string; body: URLSearchParams; auth: string | null }> = [];
    const client = createStripeClient({
      secretKey: "sk_test_123",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({
          url: String(url),
          body: new URLSearchParams(String(init?.body ?? "")),
          auth: new Headers(init?.headers).get("Authorization"),
        });
        return response;
      }) as typeof fetch,
    });
    return { client, calls };
  }

  const ok = (url: string) => new Response(JSON.stringify({ url }), { status: 200 });

  test("a subscription checkout sends the shape applyCheckoutCompleted parses back", async () => {
    const { client, calls } = capturing(ok("https://checkout.stripe.com/c/pay/cs_test"));
    const res = await client.createCheckoutSession({
      priceId: "price_monthly",
      mode: "subscription",
      clientReferenceId: "42",
      customerEmail: "buyer@example.com",
      trialPeriodDays: 7,
      successUrl: "https://app.test/billing/return",
      cancelUrl: "https://app.test/pricing?m=checkout-canceled",
    });
    expect(res).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test" });

    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(call.auth).toBe("Bearer sk_test_123");
    // Nested keys are form-encoded by hand (no SDK), so pin them exactly.
    expect(call.body.get("mode")).toBe("subscription");
    expect(call.body.get("line_items[0][price]")).toBe("price_monthly");
    expect(call.body.get("line_items[0][quantity]")).toBe("1");
    expect(call.body.get("client_reference_id")).toBe("42");
    expect(call.body.get("subscription_data[trial_period_days]")).toBe("7");
    expect(call.body.get("customer_email")).toBe("buyer@example.com");
    expect(call.body.get("automatic_tax[enabled]")).toBe("true");
  });

  test("a season pass omits trial data entirely — Stripe rejects it on mode=payment", async () => {
    const { client, calls } = capturing(ok("https://checkout.stripe.com/c/pay/cs_pass"));
    await client.createCheckoutSession({
      priceId: "price_season",
      mode: "payment",
      clientReferenceId: "7",
      trialPeriodDays: null,
      successUrl: "https://app.test/billing/return",
      cancelUrl: "https://app.test/pricing",
    });
    expect(calls[0]!.body.get("mode")).toBe("payment");
    expect(calls[0]!.body.has("subscription_data[trial_period_days]")).toBe(false);
  });

  test("a known customer suppresses customer_email — Stripe rejects both together", async () => {
    const { client, calls } = capturing(ok("https://checkout.stripe.com/c/pay/cs_ret"));
    await client.createCheckoutSession({
      priceId: "price_monthly",
      mode: "subscription",
      clientReferenceId: "9",
      customerId: "cus_existing",
      customerEmail: "returning@example.com",
      trialPeriodDays: 7,
      successUrl: "https://app.test/billing/return",
      cancelUrl: "https://app.test/pricing",
    });
    expect(calls[0]!.body.get("customer")).toBe("cus_existing");
    expect(calls[0]!.body.has("customer_email")).toBe(false);
  });

  test("an API error and a bodiless 200 both fail rather than returning a bad url", async () => {
    const failing = capturing(new Response("no such price", { status: 400 }));
    const err = await failing.client.createCheckoutSession({
      priceId: "price_missing",
      mode: "subscription",
      clientReferenceId: "1",
      successUrl: "https://app.test/r",
      cancelUrl: "https://app.test/c",
    });
    expect(err.ok).toBe(false);
    if (!err.ok) expect(err.detail).toContain("stripe HTTP 400");

    // A 200 with no `url` would otherwise redirect the buyer to "undefined".
    const empty = capturing(new Response(JSON.stringify({ id: "cs_x" }), { status: 200 }));
    const res = await empty.client.createCheckoutSession({
      priceId: "price_monthly",
      mode: "subscription",
      clientReferenceId: "1",
      successUrl: "https://app.test/r",
      cancelUrl: "https://app.test/c",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("no session url");
  });

  test("the portal posts the customer and a return url", async () => {
    const { client, calls } = capturing(ok("https://billing.stripe.com/p/session/live_x"));
    const res = await client.createPortalSession({
      customerId: "cus_abc",
      returnUrl: "https://app.test/account",
    });
    expect(res).toEqual({ ok: true, url: "https://billing.stripe.com/p/session/live_x" });
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(calls[0]!.body.get("customer")).toBe("cus_abc");
    expect(calls[0]!.body.get("return_url")).toBe("https://app.test/account");
  });

  test("the null client refuses both rather than throwing, so routes stay unconditional", async () => {
    const client = createNullStripe();
    const checkout = await client.createCheckoutSession({
      priceId: "p",
      mode: "subscription",
      clientReferenceId: "1",
      successUrl: "https://app.test/r",
      cancelUrl: "https://app.test/c",
    });
    expect(checkout).toEqual({ ok: false, detail: "stripe not configured" });
    expect(await client.createPortalSession({ customerId: "c", returnUrl: "https://app.test/a" })).toEqual({
      ok: false,
      detail: "stripe not configured",
    });
  });
});

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

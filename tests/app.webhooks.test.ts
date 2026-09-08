// Resend webhook (WS-G). This endpoint changes deliverability state from an
// unauthenticated origin, so the negative cases — forged, tampered, replayed,
// unconfigured — matter more than the happy path.
import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { signWebhook, verifyWebhookSignature } from "../src/providers/email.ts";
import { signStripePayload } from "../src/providers/stripe.ts";
import {
  handleWebhookRequest,
  handleStripeWebhookRequest,
  handleRevenueCatWebhookRequest,
  recipientOf,
  suppressionFor,
} from "../src/app/webhooks.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { testDb, seedUser } from "./seed.ts";

const SECRET = "whsec_dGVzdC1zZWNyZXQtdmFsdWU=";
const NOW = new Date("2026-09-07T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

function payload(type: string, email: string): string {
  return JSON.stringify({ type, created_at: NOW.toISOString(), data: { email_id: "e1", to: [email] } });
}

function signedRequest(
  body: string,
  opts: { id?: string; timestamp?: number; signature?: string; method?: string } = {},
): Request {
  const id = opts.id ?? "msg_1";
  const ts = String(opts.timestamp ?? NOW_S);
  const sig = opts.signature ?? `v1,${signWebhook(SECRET, id, ts, body)}`;
  return new Request("http://x/webhooks/resend", {
    method: opts.method ?? "POST",
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": sig },
    body: opts.method === "GET" ? undefined : body,
  });
}

let db: Database;
let p: { db: Database };
const url = new URL("http://x/webhooks/resend");

beforeEach(() => {
  db = testDb();
  p = { db };
  const userId = seedUser(db, { email: "sub@example.com" });
  accountsService.setEmailPref(p, userId, "recap", true, NOW);
});

describe("signature verification", () => {
  const body = payload("email.bounced", "sub@example.com");

  test("a correctly signed request verifies", () => {
    const verdict = verifyWebhookSignature({
      secret: SECRET,
      headers: { id: "msg_1", timestamp: String(NOW_S), signature: `v1,${signWebhook(SECRET, "msg_1", String(NOW_S), body)}` },
      body,
      nowSeconds: NOW_S,
    });
    expect(verdict.ok).toBe(true);
  });

  test("a body changed after signing is rejected", () => {
    const sig = `v1,${signWebhook(SECRET, "msg_1", String(NOW_S), body)}`;
    const verdict = verifyWebhookSignature({
      secret: SECRET,
      headers: { id: "msg_1", timestamp: String(NOW_S), signature: sig },
      body: payload("email.bounced", "attacker@example.com"),
      nowSeconds: NOW_S,
    });
    expect(verdict).toEqual({ ok: false, reason: "signature mismatch" });
  });

  test("a signature from a different secret is rejected", () => {
    const verdict = verifyWebhookSignature({
      secret: SECRET,
      headers: { id: "msg_1", timestamp: String(NOW_S), signature: `v1,${signWebhook("whsec_b3RoZXI=", "msg_1", String(NOW_S), body)}` },
      body,
      nowSeconds: NOW_S,
    });
    expect(verdict.ok).toBe(false);
  });

  test("a replayed request outside the tolerance window is rejected", () => {
    const oldTs = NOW_S - 6 * 60;
    const verdict = verifyWebhookSignature({
      secret: SECRET,
      headers: { id: "msg_1", timestamp: String(oldTs), signature: `v1,${signWebhook(SECRET, "msg_1", String(oldTs), body)}` },
      body,
      nowSeconds: NOW_S,
    });
    expect(verdict).toEqual({ ok: false, reason: "timestamp outside tolerance" });
  });

  test("missing or malformed headers are rejected before any parsing", () => {
    expect(verifyWebhookSignature({ secret: SECRET, headers: { id: null, timestamp: "1", signature: "v1,x" }, body, nowSeconds: NOW_S })).toEqual({ ok: false, reason: "missing signature headers" });
    expect(verifyWebhookSignature({ secret: SECRET, headers: { id: "a", timestamp: "not-a-number", signature: "v1,x" }, body, nowSeconds: NOW_S })).toEqual({ ok: false, reason: "malformed timestamp" });
  });

  test("multiple space-separated signatures verify if any matches (secret rotation)", () => {
    const good = signWebhook(SECRET, "msg_1", String(NOW_S), body);
    const verdict = verifyWebhookSignature({
      secret: SECRET,
      headers: { id: "msg_1", timestamp: String(NOW_S), signature: `v1,AAAA v1,${good}` },
      body,
      nowSeconds: NOW_S,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("payload parsing", () => {
  test("recipient comes from to[], to, or email — and nothing else", () => {
    expect(recipientOf({ data: { to: ["a@b.c"] } })).toBe("a@b.c");
    expect(recipientOf({ data: { to: "a@b.c" } })).toBe("a@b.c");
    expect(recipientOf({ data: { email: "a@b.c" } })).toBe("a@b.c");
    expect(recipientOf({ data: {} })).toBeNull();
    expect(recipientOf({})).toBeNull();
    expect(recipientOf(null)).toBeNull();
    expect(recipientOf("nope")).toBeNull();
  });

  test("only bounces and complaints suppress", () => {
    expect(suppressionFor("email.bounced")).toBe("bounced");
    expect(suppressionFor("email.complained")).toBe("complained");
    expect(suppressionFor("email.delivered")).toBeNull();
    expect(suppressionFor("email.opened")).toBeNull();
  });
});

describe("webhook route", () => {
  const deps = { secret: SECRET, now: () => NOW };

  test("a signed bounce suppresses the address and stops future digests", async () => {
    const body = payload("email.bounced", "sub@example.com");
    const res = (await handleWebhookRequest(p, signedRequest(body), url, deps))!;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: true, suppressed: true });
    expect(accountsService.digestRecipients(p, "recap")).toEqual([]);
  });

  test("a spam complaint suppresses too, and the account page can say why", async () => {
    const body = payload("email.complained", "sub@example.com");
    await handleWebhookRequest(p, signedRequest(body), url, deps);

    const prefs = accountsService.emailPrefs(p, 1, NOW);
    expect(prefs.complainedAt).toBe(NOW.toISOString());
    expect(prefs.bouncedAt).toBeNull();
  });

  test("a delivery event is recorded but suppresses nothing", async () => {
    const body = payload("email.delivered", "sub@example.com");
    const res = (await handleWebhookRequest(p, signedRequest(body), url, deps))!;

    expect(await res.json()).toEqual({ ok: true, recorded: true, suppressed: false });
    expect(accountsService.digestRecipients(p, "recap").length).toBe(1);
  });

  test("a provider retry of the same event is idempotent", async () => {
    const body = payload("email.bounced", "sub@example.com");
    await handleWebhookRequest(p, signedRequest(body), url, deps);
    const again = (await handleWebhookRequest(p, signedRequest(body), url, deps))!;

    expect(await again.json()).toEqual({ ok: true, recorded: false, suppressed: false });
  });

  test("an unsigned or forged request never reaches the database", async () => {
    const body = payload("email.bounced", "sub@example.com");
    const forged = new Request("http://x/webhooks/resend", { method: "POST", body });
    const res = (await handleWebhookRequest(p, forged, url, deps))!;

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(accountsService.digestRecipients(p, "recap").length).toBe(1);
  });

  test("without a configured secret the endpoint refuses rather than trusting input", async () => {
    const body = payload("email.bounced", "sub@example.com");
    const res = (await handleWebhookRequest(p, signedRequest(body), url, { secret: null, now: () => NOW }))!;

    expect(res.status).toBe(503);
    expect(accountsService.digestRecipients(p, "recap").length).toBe(1);
  });

  test("a valid signature over non-JSON, or JSON without a recipient, is a 400", async () => {
    const bad = (await handleWebhookRequest(p, signedRequest("not json"), url, deps))!;
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_json" });

    const noTo = (await handleWebhookRequest(p, signedRequest(JSON.stringify({ type: "email.bounced" })), url, deps))!;
    expect(noTo.status).toBe(400);
    expect(await noTo.json()).toEqual({ error: "no_recipient" });
  });

  test("an event for an address with no account is recorded, not an error", async () => {
    const body = payload("email.bounced", "stranger@example.com");
    const res = (await handleWebhookRequest(p, signedRequest(body), url, deps))!;

    expect(await res.json()).toEqual({ ok: true, recorded: true, suppressed: false });
  });

  test("GET is refused and other paths fall through to the site router", async () => {
    const get = (await handleWebhookRequest(p, signedRequest("", { method: "GET" }), url, deps))!;
    expect(get.status).toBe(405);
    expect(
      await handleWebhookRequest(p, signedRequest("{}"), new URL("http://x/health"), deps),
    ).toBeNull();
  });
});

// --- Stripe endpoint (WS-E) ---

describe("stripe webhook endpoint", () => {
  const STRIPE_SECRET = "whsec_stripe_test";
  const stripeUrl = new URL("http://x/webhooks/stripe");
  const stripeDeps = { secret: STRIPE_SECRET, now: () => NOW };

  function stripeBody(id: string): string {
    return JSON.stringify({
      id,
      type: "checkout.session.completed",
      created: NOW_S,
      data: { object: { mode: "payment", customer: "cus_wh", client_reference_id: "42" } },
    });
  }

  function stripeRequest(body: string, opts: { signature?: string; method?: string } = {}): Request {
    const sig = opts.signature ?? `t=${NOW_S},v1=${signStripePayload(STRIPE_SECRET, String(NOW_S), body)}`;
    return new Request("http://x/webhooks/stripe", {
      method: opts.method ?? "POST",
      headers: { "stripe-signature": sig },
      body: opts.method === "GET" ? undefined : body,
    });
  }

  test("a signed event reaches the state machine; the replay is a no-op", async () => {
    const body = stripeBody("evt_wh_1");
    const res = (await handleStripeWebhookRequest(p, stripeRequest(body), stripeUrl, stripeDeps))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true, action: "season_pass_granted" });

    const replay = (await handleStripeWebhookRequest(p, stripeRequest(body), stripeUrl, stripeDeps))!;
    expect(await replay.json()).toEqual({ ok: true, applied: false, action: "duplicate" });
  });

  test("a bad signature never reaches the state machine", async () => {
    const body = stripeBody("evt_wh_2");
    const res = (await handleStripeWebhookRequest(
      p, stripeRequest(body, { signature: `t=${NOW_S},v1=${"0".repeat(64)}` }), stripeUrl, stripeDeps,
    ))!;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    // The event was not recorded: the same id still applies afterwards.
    const good = (await handleStripeWebhookRequest(p, stripeRequest(body), stripeUrl, stripeDeps))!;
    expect(await good.json()).toMatchObject({ applied: true });
  });

  test("unconfigured secret answers 503; signed garbage answers 400", async () => {
    const off = (await handleStripeWebhookRequest(
      p, stripeRequest(stripeBody("evt_wh_3")), stripeUrl, { secret: null, now: () => NOW },
    ))!;
    expect(off.status).toBe(503);

    const badJson = (await handleStripeWebhookRequest(p, stripeRequest("not json"), stripeUrl, stripeDeps))!;
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: "invalid_json" });

    const badShape = (await handleStripeWebhookRequest(p, stripeRequest("{}"), stripeUrl, stripeDeps))!;
    expect(badShape.status).toBe(400);
    expect(await badShape.json()).toEqual({ error: "malformed_event" });
  });

  test("GET is refused and other paths fall through to the site router", async () => {
    const get = (await handleStripeWebhookRequest(p, stripeRequest("", { method: "GET" }), stripeUrl, stripeDeps))!;
    expect(get.status).toBe(405);
    expect(
      await handleStripeWebhookRequest(p, stripeRequest("{}"), new URL("http://x/health"), stripeDeps),
    ).toBeNull();
  });
});

// --- RevenueCat endpoint (WS-J) ---

describe("revenuecat webhook endpoint", () => {
  const RC_SECRET = "rc_whsec_test";
  const rcUrl = new URL("http://x/webhooks/revenuecat");
  const rcDeps = { secret: RC_SECRET, now: () => NOW };

  function rcBody(id: string): string {
    return JSON.stringify({
      event: {
        id,
        type: "NON_RENEWING_PURCHASE",
        app_user_id: "42",
        event_timestamp_ms: NOW.getTime(),
        store: "APP_STORE",
      },
    });
  }

  function rcRequest(body: string, opts: { authorization?: string | null; method?: string } = {}): Request {
    const headers: Record<string, string> = {};
    const auth = opts.authorization === undefined ? RC_SECRET : opts.authorization;
    if (auth !== null) headers.authorization = auth;
    return new Request("http://x/webhooks/revenuecat", {
      method: opts.method ?? "POST",
      headers,
      body: opts.method === "GET" ? undefined : body,
    });
  }

  test("an authorized event reaches the state machine; the replay is a no-op", async () => {
    const body = rcBody("rc_evt_wh_1");
    const res = (await handleRevenueCatWebhookRequest(p, rcRequest(body), rcUrl, rcDeps))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true, action: "season_pass_granted" });

    const replay = (await handleRevenueCatWebhookRequest(p, rcRequest(body), rcUrl, rcDeps))!;
    expect(await replay.json()).toEqual({ ok: true, applied: false, action: "duplicate" });
  });

  test("a missing or wrong Authorization header never reaches the state machine", async () => {
    const body = rcBody("rc_evt_wh_2");
    const wrong = (await handleRevenueCatWebhookRequest(
      p, rcRequest(body, { authorization: "wrong" }), rcUrl, rcDeps,
    ))!;
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "invalid_authorization" });

    const missing = (await handleRevenueCatWebhookRequest(
      p, rcRequest(body, { authorization: null }), rcUrl, rcDeps,
    ))!;
    expect(missing.status).toBe(401);

    // The event was not recorded: the same id still applies afterwards.
    const good = (await handleRevenueCatWebhookRequest(p, rcRequest(body), rcUrl, rcDeps))!;
    expect(await good.json()).toMatchObject({ applied: true });
  });

  test("a Bearer-prefixed Authorization header is also accepted", async () => {
    const body = rcBody("rc_evt_wh_bearer");
    const res = (await handleRevenueCatWebhookRequest(
      p, rcRequest(body, { authorization: `Bearer ${RC_SECRET}` }), rcUrl, rcDeps,
    ))!;
    expect(res.status).toBe(200);
  });

  test("unconfigured secret answers 503; authorized garbage answers 400", async () => {
    const off = (await handleRevenueCatWebhookRequest(
      p, rcRequest(rcBody("rc_evt_wh_3")), rcUrl, { secret: null, now: () => NOW },
    ))!;
    expect(off.status).toBe(503);

    const badJson = (await handleRevenueCatWebhookRequest(p, rcRequest("not json"), rcUrl, rcDeps))!;
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: "invalid_json" });

    const badShape = (await handleRevenueCatWebhookRequest(p, rcRequest("{}"), rcUrl, rcDeps))!;
    expect(badShape.status).toBe(400);
    expect(await badShape.json()).toEqual({ error: "malformed_event" });
  });

  test("GET is refused and other paths fall through to the site router", async () => {
    const get = (await handleRevenueCatWebhookRequest(p, rcRequest("", { method: "GET" }), rcUrl, rcDeps))!;
    expect(get.status).toBe(405);
    expect(
      await handleRevenueCatWebhookRequest(p, rcRequest("{}"), new URL("http://x/health"), rcDeps),
    ).toBeNull();
  });
});

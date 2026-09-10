// End-to-end WS-E outbound half: /pricing rendering, Checkout and Portal.
//
// The bar these routes have to clear is narrow but sharp — they must never
// grant Pro (only the webhook writes entitlement) and must never send a paying
// customer to Stripe without `client_reference_id`, which is the sole link
// from a payment back to an account. Both are asserted below.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { readServerEnv } from "../src/app/env.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNullStripe } from "../src/providers/stripe.ts";
import type { CheckoutSessionRequest, StripeClient } from "../src/providers/stripe.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { testDb, seedDriver, seedRace, seedResult } from "./seed.ts";

const PW = "orange-gearbox-77";

let server: Server<undefined>;
let bare: Server<undefined>;
let base: string;
let bareBase: string;
let providers: Providers;

const checkoutCalls: CheckoutSessionRequest[] = [];
const portalCalls: Array<{ customerId: string; returnUrl: string }> = [];
/** Flipped by the failure test; Stripe being down must not 500 the site. */
let stripeUp = true;

function fakeStripe(): StripeClient {
  return {
    ...createNullStripe(),
    configured: true,
    async createCheckoutSession(req) {
      checkoutCalls.push(req);
      return stripeUp
        ? { ok: true, url: "https://checkout.stripe.test/session/abc" }
        : { ok: false, detail: "stripe HTTP 500: boom" };
    },
    async createPortalSession(req) {
      portalCalls.push(req);
      return stripeUp
        ? { ok: true, url: "https://billing.stripe.test/portal/xyz" }
        : { ok: false, detail: "stripe HTTP 500: boom" };
    },
  };
}

function config(overrides: Record<string, string> = {}) {
  return readServerEnv({ APP_BASE_URL: "https://example.test", ...overrides }).config;
}

beforeAll(() => {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedRace(db, { raceId: 100, season: 2024, raceDateUtc: "2024-03-01T18:00:00", raceName: "Test 400" });
  seedResult(db, { raceId: 100, driverId: 10, finish: 1, start: 3, points: 50, carNumber: "5" });

  providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
    stripe: fakeStripe(),
  };

  server = createServer(
    providers,
    0,
    config({ STRIPE_PRICE_MONTHLY: "price_monthly_1", STRIPE_PRICE_SEASON: "price_season_1" }),
    { email: { configured: true, send: async () => ({ ok: true, detail: "test" }) } },
  );
  base = server.url.toString().replace(/\/$/, "");

  // A second server on the same db with no Stripe at all — the state the
  // product is actually in until the owner finishes E1-E3.
  bare = createServer({ ...providers, stripe: createNullStripe() }, 0, config(), {
    email: { configured: true, send: async () => ({ ok: true, detail: "test" }) },
  });
  bareBase = bare.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);
  bare.stop(true);
});

type Jar = Record<string, string>;

function absorb(jar: Jar, res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0]!;
    const eq = pair.indexOf("=");
    const value = pair.slice(eq + 1);
    if (value === "") delete jar[pair.slice(0, eq)];
    else jar[pair.slice(0, eq)] = value;
  }
}

function headers(jar: Jar, ip: string): Record<string, string> {
  const h: Record<string, string> = { "x-forwarded-for": ip };
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) h.cookie = cookie;
  return h;
}

async function browse(jar: Jar, ip: string, path: string, origin = base): Promise<Response> {
  const res = await fetch(`${origin}${path}`, { headers: headers(jar, ip), redirect: "manual" });
  absorb(jar, res);
  return res;
}

async function post(jar: Jar, ip: string, path: string, fields: Record<string, string>): Promise<Response> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: headers(jar, ip),
    body: new URLSearchParams({ csrf: jar.csrf ?? "", ...fields }),
    redirect: "manual",
  });
  absorb(jar, res);
  return res;
}

/** Signed-in session, verified unless asked otherwise. */
async function signIn(jar: Jar, ip: string, email: string, verified = true): Promise<number> {
  await browse(jar, ip, "/pricing");
  const created = accountsService.signUp(providers, email, PW, new Date());
  const user = await created;
  if (!user.ok) throw new Error(`seed sign-up failed: ${user.reason}`);
  const userId = user.user.userId;
  if (verified) {
    const token = accountsService.createVerifyToken(providers, userId, new Date());
    accountsService.verifyEmail(providers, token, new Date());
  }
  const session = accountsService.createSession(providers, userId, new Date());
  jar.session = session;
  return userId;
}

describe("/pricing rendering", () => {
  test("anonymous visitors are asked to sign up, not shown a dead buy button", async () => {
    const res = await browse({}, "10.1.0.1", "/pricing");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('action="/billing/checkout"');
  });

  test("a verified signed-in user gets both buy buttons", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.1.0.2", "buyer-render@example.com");
    const html = await (await browse(jar, "10.1.0.2", "/pricing")).text();
    expect(html).toContain('action="/billing/checkout"');
    expect(html).toContain('value="monthly"');
    expect(html).toContain('value="season"');
    expect(html).toContain("Start 7-day free trial");
  });

  test("an unverified user is told to verify instead of being offered checkout", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.1.0.3", "unverified-render@example.com", false);
    const html = await (await browse(jar, "10.1.0.3", "/pricing")).text();
    expect(html).toContain("Verify your email address before upgrading");
    expect(html).not.toContain('action="/billing/checkout"');
  });

  test("with no Stripe configured the page renders the honest 'opens soon' copy, not a 500", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.1.0.4", "nostripe@example.com");
    const res = await browse(jar, "10.1.0.4", "/pricing", bareBase);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Checkout opens soon");
    expect(html).not.toContain('action="/billing/checkout"');
  });
});

describe("POST /billing/checkout", () => {
  test("hands Stripe the user id as client_reference_id — the only payment→account link", async () => {
    const jar: Jar = {};
    const userId = await signIn(jar, "10.2.0.1", "buyer@example.com");
    checkoutCalls.length = 0;

    const res = await post(jar, "10.2.0.1", "/billing/checkout", { plan: "monthly" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://checkout.stripe.test/session/abc");

    expect(checkoutCalls).toHaveLength(1);
    const call = checkoutCalls[0]!;
    expect(call.clientReferenceId).toBe(String(userId));
    expect(call.mode).toBe("subscription");
    expect(call.priceId).toBe("price_monthly_1");
    expect(call.trialPeriodDays).toBe(7);
    expect(call.successUrl).toBe("https://example.test/billing/return");
    expect(call.cancelUrl).toBe("https://example.test/pricing?m=checkout-canceled");

    // The route itself must not have granted anything.
    expect(billingService.isPro(providers, userId, new Date())).toBe(false);
  });

  test("the season pass is a one-time payment with no trial", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.2.0.2", "passbuyer@example.com");
    checkoutCalls.length = 0;
    await post(jar, "10.2.0.2", "/billing/checkout", { plan: "season" });
    const call = checkoutCalls[0]!;
    expect(call.mode).toBe("payment");
    expect(call.priceId).toBe("price_season_1");
    expect(call.trialPeriodDays).toBeNull();
  });

  test("reuses an existing Stripe customer instead of creating a duplicate", async () => {
    const jar: Jar = {};
    const userId = await signIn(jar, "10.2.0.3", "returning@example.com");
    billingService.applyStripeEvent(
      providers,
      {
        id: "evt_seed_customer",
        type: "checkout.session.completed",
        created: 1_700_000_000,
        data: { object: { customer: "cus_existing", client_reference_id: String(userId), mode: "subscription" } },
      },
      new Date(),
    );
    checkoutCalls.length = 0;
    await post(jar, "10.2.0.3", "/billing/checkout", { plan: "monthly" });
    expect(checkoutCalls[0]!.customerId).toBe("cus_existing");
    // The route always passes the email; dropping it when a customer is set is
    // the provider's job (Stripe rejects both together) — asserted at the wire
    // level in tests/providers.stripe.test.ts.
    expect(checkoutCalls[0]!.customerEmail).toBe("returning@example.com");
  });

  test("a missing CSRF token is refused before Stripe is touched", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.2.0.4", "csrf@example.com");
    checkoutCalls.length = 0;
    const res = await fetch(`${base}/billing/checkout`, {
      method: "POST",
      headers: headers(jar, "10.2.0.4"),
      body: new URLSearchParams({ plan: "monthly" }), // no csrf field
      redirect: "manual",
    });
    expect(res.status).toBe(403);
    expect(checkoutCalls).toHaveLength(0);
  });

  test("signed-out buyers are sent to sign in, not to Stripe", async () => {
    const jar: Jar = {};
    await browse(jar, "10.2.0.5", "/pricing"); // csrf cookie only
    checkoutCalls.length = 0;
    const res = await post(jar, "10.2.0.5", "/billing/checkout", { plan: "monthly" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/signin?m=signin-to-upgrade");
    expect(checkoutCalls).toHaveLength(0);
  });

  test("an unverified email is refused server-side, not just hidden in the UI", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.2.0.6", "unverified-post@example.com", false);
    checkoutCalls.length = 0;
    const res = await post(jar, "10.2.0.6", "/billing/checkout", { plan: "monthly" });
    expect(res.headers.get("Location")).toBe("/account?m=verify-first");
    expect(checkoutCalls).toHaveLength(0);
  });

  test("an existing Pro is not allowed to pay twice", async () => {
    const jar: Jar = {};
    const userId = await signIn(jar, "10.2.0.7", "alreadypro@example.com");
    billingService.grantPro(providers, userId, "2030-01-01T00:00:00Z", "grant", new Date());
    checkoutCalls.length = 0;
    const res = await post(jar, "10.2.0.7", "/billing/checkout", { plan: "monthly" });
    expect(res.headers.get("Location")).toBe("/account?m=already-pro");
    expect(checkoutCalls).toHaveLength(0);
  });

  test("an unknown plan is unavailable rather than an error", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.2.0.8", "badplan@example.com");
    checkoutCalls.length = 0;
    const res = await post(jar, "10.2.0.8", "/billing/checkout", { plan: "lifetime" });
    expect(res.headers.get("Location")).toBe("/pricing?m=plan-unavailable");
    expect(checkoutCalls).toHaveLength(0);
  });

  test("Stripe being down redirects with an apology instead of 500ing", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.2.0.9", "stripedown@example.com");
    stripeUp = false;
    try {
      const res = await post(jar, "10.2.0.9", "/billing/checkout", { plan: "monthly" });
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/pricing?m=checkout-failed");
    } finally {
      stripeUp = true;
    }
  });
});

describe("POST /billing/portal", () => {
  test("opens the portal for someone with a Stripe customer", async () => {
    const jar: Jar = {};
    const userId = await signIn(jar, "10.3.0.1", "portal@example.com");
    billingService.applyStripeEvent(
      providers,
      {
        id: "evt_seed_portal",
        type: "checkout.session.completed",
        created: 1_700_000_100,
        data: { object: { customer: "cus_portal", client_reference_id: String(userId), mode: "subscription" } },
      },
      new Date(),
    );
    portalCalls.length = 0;
    const res = await post(jar, "10.3.0.1", "/billing/portal", {});
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://billing.stripe.test/portal/xyz");
    expect(portalCalls[0]).toEqual({
      customerId: "cus_portal",
      returnUrl: "https://example.test/account",
    });
  });

  test("someone with no web billing account is told so, not sent to a stranger's portal", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.3.0.2", "noprofile@example.com");
    portalCalls.length = 0;
    const res = await post(jar, "10.3.0.2", "/billing/portal", {});
    expect(res.headers.get("Location")).toBe("/account?m=no-billing-account");
    expect(portalCalls).toHaveLength(0);
  });
});

describe("GET /billing/return", () => {
  test("does not claim Pro before the webhook has granted it", async () => {
    const jar: Jar = {};
    await signIn(jar, "10.4.0.1", "returning-buyer@example.com");
    const html = await (await browse(jar, "10.4.0.1", "/billing/return")).text();
    expect(html).toContain("activating your account");
    expect(html).not.toContain("everything is unlocked");
  });

  test("confirms Pro once the entitlement exists", async () => {
    const jar: Jar = {};
    const userId = await signIn(jar, "10.4.0.2", "granted-buyer@example.com");
    billingService.grantPro(providers, userId, "2030-01-01T00:00:00Z", "grant", new Date());
    const html = await (await browse(jar, "10.4.0.2", "/billing/return")).text();
    expect(html).toContain("everything is unlocked");
  });
});

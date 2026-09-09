// End-to-end WS-D: real server, captured emails, browser-style cookie jar.
// Covers the launch plan's acceptance list — sign-up→verify→sign-in, CSRF
// miss, rate-limit trip, reset misuse, teaser vs Pro on gated pages, and the
// public/private cache-header split.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type { EmailMessage } from "../src/providers/email.ts";
import { createServer } from "../src/app/server.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNullStripe } from "../src/providers/stripe.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { testDb, seedDriver, seedRace, seedResult } from "./seed.ts";

let server: Server<undefined>;
let base: string;
let providers: Providers;
const sentEmails: EmailMessage[] = [];
const PW = "orange-gearbox-77";

beforeAll(() => {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedRace(db, { raceId: 100, season: 2024, raceDateUtc: "2024-03-01T18:00:00", raceName: "Test 400" });
  seedResult(db, { raceId: 100, driverId: 10, finish: 1, start: 3, points: 50, carNumber: "5" });
  seedDriver(db, 30, "Xfinity Only");
  seedRace(db, { raceId: 200, season: 2024, seriesId: 2, raceDateUtc: "2024-03-05T18:00:00", raceName: "Xfinity 250" });
  seedResult(db, { raceId: 200, driverId: 30, finish: 1, start: 2, points: 48, carNumber: "88" });

  providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
    stripe: createNullStripe(),
  };
  analyticsService.computeAll(providers);
  analyticsService.computeAll(providers, 2);
  server = createServer(providers, 0, undefined, {
    email: { configured: true, send: async (msg) => (sentEmails.push(msg), { ok: true, detail: "test" }) },
  });
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);
});

// --- a tiny browser: cookie jar + form posts, per-test client IP ---

type Jar = Record<string, string>;

function absorb(jar: Jar, res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0]!;
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === "") delete jar[name];
    else jar[name] = value;
  }
}

function headers(jar: Jar, ip: string): Record<string, string> {
  const h: Record<string, string> = { "x-forwarded-for": ip };
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) h.cookie = cookie;
  return h;
}

async function browse(jar: Jar, ip: string, path: string): Promise<Response> {
  const res = await fetch(`${base}${path}`, { headers: headers(jar, ip), redirect: "manual" });
  absorb(jar, res);
  return res;
}

async function post(jar: Jar, ip: string, path: string, fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams({ csrf: jar.csrf ?? "", ...fields });
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: headers(jar, ip),
    body,
    redirect: "manual",
  });
  absorb(jar, res);
  return res;
}

async function signUpFlow(jar: Jar, ip: string, email: string): Promise<void> {
  await browse(jar, ip, "/signup"); // installs the csrf cookie
  const res = await post(jar, ip, "/auth/signup", { email, password: PW });
  expect(res.status).toBe(303);
  expect(res.headers.get("Location")).toBe("/account?m=check-email");
  expect(jar.session).toBeDefined();
}

describe("sign-up → verify → sign-in", () => {
  test("the full happy path works end to end", async () => {
    const jar: Jar = {};
    const ip = "10.0.0.1";
    await signUpFlow(jar, ip, "flow@example.com");

    // The verification email carries a working absolute link.
    const mail = sentEmails.find((m) => m.to === "flow@example.com")!;
    expect(mail.subject).toBe("Verify your Looplab email");
    const link = mail.text.match(/(http[^\s]+\/verify\/[A-Za-z0-9_-]+)/)![1]!;
    const verify = await fetch(link, { headers: headers(jar, ip), redirect: "manual" });
    expect(verify.status).toBe(303);
    expect(verify.headers.get("Location")).toBe("/account?m=verified");

    // Account page shows the verified state; sign-out then sign back in.
    const account = await browse(jar, ip, "/account");
    expect(await account.text()).toContain("Email verified");
    await post(jar, ip, "/auth/signout", {});
    expect((await browse(jar, ip, "/account")).status).toBe(303); // anon again

    const signin = await post(jar, ip, "/auth/signin", { email: "flow@example.com", password: PW });
    expect(signin.status).toBe(303);
    expect(signin.headers.get("Location")).toBe("/account");
  });

  test("wrong password re-renders sign-in with 401 and the generic reason", async () => {
    const jar: Jar = {};
    const ip = "10.0.0.2";
    await signUpFlow(jar, ip, "wrongpw@example.com");
    await post(jar, ip, "/auth/signout", {});
    const res = await post(jar, ip, "/auth/signin", { email: "wrongpw@example.com", password: "not-the-password-9" });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Invalid email or password.");
  });

  test("a POST without its CSRF token is refused with 403", async () => {
    const res = await fetch(`${base}/auth/signin`, {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.3" },
      body: new URLSearchParams({ email: "a@b.c", password: PW }),
      redirect: "manual",
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("missing its security token");
  });

  test("sign-in rate limit trips at 10 attempts with a Retry-After", async () => {
    const jar: Jar = {};
    const ip = "10.0.0.4";
    await browse(jar, ip, "/signin");
    for (let i = 0; i < 10; i++) {
      const res = await post(jar, ip, "/auth/signin", { email: `probe${i}@example.com`, password: "bad-password-11" });
      expect(res.status).toBe(401);
    }
    const tripped = await post(jar, ip, "/auth/signin", { email: "probe@example.com", password: "bad-password-11" });
    expect(tripped.status).toBe(429);
    expect(Number(tripped.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("password reset", () => {
  test("emailed link resets the password once and kills existing sessions", async () => {
    const jar: Jar = {};
    const ip = "10.0.1.1";
    await signUpFlow(jar, ip, "reset@example.com");

    await post(jar, ip, "/auth/reset-request", { email: "reset@example.com" });
    const mail = sentEmails.find((m) => m.to === "reset@example.com" && m.subject.includes("Reset"))!;
    const token = mail.text.match(/\/reset\/([A-Za-z0-9_-]+)/)![1]!;

    const done = await post(jar, ip, "/auth/reset-confirm", { token, password: "fresh-new-pw-2026" });
    expect(done.status).toBe(303);
    expect(done.headers.get("Location")).toBe("/signin?m=reset-done");
    // The pre-reset session died with the reset.
    expect((await browse(jar, ip, "/account")).status).toBe(303);
    // Token reuse fails.
    await browse(jar, ip, "/signin");
    const reuse = await post(jar, ip, "/auth/reset-confirm", { token, password: "another-pw-2027" });
    expect(reuse.status).toBe(400);
    expect(await reuse.text()).toContain("invalid, used, or expired");
  });

  test("requests for unknown emails answer identically and send nothing", async () => {
    const jar: Jar = {};
    const ip = "10.0.1.2";
    await browse(jar, ip, "/reset");
    const before = sentEmails.length;
    const res = await post(jar, ip, "/auth/reset-request", { email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("a reset link is on its way");
    expect(sentEmails.length).toBe(before);
  });
});

describe("gating (acceptance: teaser vs Pro vs cache headers)", () => {
  test("anonymous /xfinity/drivers/30 gets the teaser, not the data", async () => {
    const res = await fetch(`${base}/xfinity/drivers/30`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("teaser-lock");
    expect(body).toContain('href="/pricing"');
    expect(body).not.toContain("Race log"); // no real profile content
  });

  test("a Pro viewer gets the real page; a signed-in free user still gets the teaser", async () => {
    const jar: Jar = {};
    const ip = "10.0.2.1";
    await signUpFlow(jar, ip, "gates@example.com");
    const freeRes = await browse(jar, ip, "/xfinity/drivers/30");
    expect(await freeRes.text()).toContain("teaser-lock");

    const me = accountsService.findUserByEmail(providers, "gates@example.com")!;
    billingService.grantPro(providers, me.userId, "2099-01-01T00:00:00Z", "grant", new Date());
    const proRes = await browse(jar, ip, "/xfinity/drivers/30");
    const body = await proRes.text();
    expect(body).not.toContain("teaser-lock");
    expect(body).toContain("Xfinity Only");
    // Gated page for a signed-in viewer is private.
    expect(proRes.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("series JSON is refused for anonymous viewers (teaser can't be bypassed)", async () => {
    const data = await fetch(`${base}/data/season-stats-2.json`);
    expect(data.status).toBe(403);
    expect(await data.json()).toEqual({ error: "pro_required", upgrade: "/pricing" });
    expect((await fetch(`${base}/api/drivers?series=2`)).status).toBe(403);
    expect((await fetch(`${base}/api/recap/200`)).status).toBe(403); // race-derived series
    expect((await fetch(`${base}/data/season-stats-1.json`)).status).toBe(200);
  });

  test("anonymous Cup pages stay publicly cacheable; auth pages never cache", async () => {
    const cup = await fetch(`${base}/`);
    expect(cup.headers.get("Cache-Control")).toBe("public, max-age=300, stale-while-revalidate=600");
    expect((await fetch(`${base}/signin`)).headers.get("Cache-Control")).toBe("private, no-store");
    expect((await fetch(`${base}/account`, { redirect: "manual" })).headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("career pages stay free (spec: cross-series totals for everyone)", async () => {
    const res = await fetch(`${base}/driver/30`);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("teaser-lock");
  });
});

describe("account deletion", () => {
  test("password-confirmed delete removes the account and its sessions", async () => {
    const jar: Jar = {};
    const ip = "10.0.3.1";
    await signUpFlow(jar, ip, "gone@example.com");

    const wrong = await post(jar, ip, "/auth/delete", { password: "not-my-password-3" });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain("Password is incorrect.");

    const oldSession = jar.session!;
    const done = await post(jar, ip, "/auth/delete", { password: PW });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("Account deleted");
    // The old session token is dead even if replayed.
    jar.session = oldSession;
    expect((await browse(jar, ip, "/account")).status).toBe(303);
    expect(accountsService.findUserByEmail(providers, "gone@example.com")).toBeNull();
  });

  test("deletion cancels a live subscription at Stripe first; a Stripe failure blocks it (WS-E)", async () => {
    const jar: Jar = {};
    const ip = "10.0.3.2";
    await signUpFlow(jar, ip, "paying@example.com");
    const me = accountsService.findUserByEmail(providers, "paying@example.com")!;
    const now = new Date();
    const created = Math.floor(now.getTime() / 1000);
    billingService.applyStripeEvent(providers, {
      id: "evt_del_1", type: "checkout.session.completed", created,
      data: { object: { mode: "subscription", customer: "cus_del", client_reference_id: String(me.userId), subscription: "sub_del" } },
    }, now);
    billingService.applyStripeEvent(providers, {
      id: "evt_del_2", type: "customer.subscription.created", created: created + 1,
      data: { object: { id: "sub_del", customer: "cus_del", status: "active", current_period_end: created + 30 * 86400 } },
    }, now);
    expect(billingService.isPro(providers, me.userId, now)).toBe(true);

    const original = providers.stripe;
    const canceled: string[] = [];
    try {
      // Stripe down: the account (and its paying subscription) must survive.
      providers.stripe = {
        configured: true,
        cancelSubscription: async () => ({ ok: false, detail: "stripe HTTP 500: boom" }),
      };
      const blocked = await post(jar, ip, "/auth/delete", { password: PW });
      expect(blocked.status).toBe(502);
      expect(await blocked.text()).toContain("could not cancel your subscription");
      expect(accountsService.findUserByEmail(providers, "paying@example.com")).not.toBeNull();

      // Stripe up: cancel exactly the live subscription, then delete.
      providers.stripe = {
        configured: true,
        cancelSubscription: async (id) => (canceled.push(id), { ok: true, detail: "canceled" }),
      };
      const done = await post(jar, ip, "/auth/delete", { password: PW });
      expect(done.status).toBe(200);
      expect(await done.text()).toContain("Account deleted");
      expect(canceled).toEqual(["sub_del"]);
      expect(accountsService.findUserByEmail(providers, "paying@example.com")).toBeNull();
      expect(billingService.isPro(providers, me.userId, now)).toBe(false);
    } finally {
      providers.stripe = original;
    }
  });
});

// A mail provider that is down must not be reported to the user as a send.
// Verification gates upgrading, so a silent failure strands the account.
describe("email send failures are reported, not claimed", () => {
  let downServer: Server<undefined>;
  let downBase: string;

  beforeAll(() => {
    downServer = createServer(providers, 0, undefined, {
      email: {
        configured: true,
        send: async () => ({ ok: false, detail: "resend HTTP 500: down" }),
      },
    });
    downBase = downServer.url.toString().replace(/\/$/, "");
  });

  afterAll(() => downServer.stop(true));

  async function postTo(jar: Jar, ip: string, path: string, fields: Record<string, string>) {
    const res = await fetch(`${downBase}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
        "X-Forwarded-For": ip,
      },
      body: new URLSearchParams({ csrf: jar.csrf ?? "", ...fields }),
      redirect: "manual",
    });
    absorb(jar, res);
    return res;
  }

  test("sign-up says the verification email failed instead of 'check your email'", async () => {
    const jar: Jar = {};
    const ip = "203.0.113.90";
    absorb(jar, await fetch(`${downBase}/signup`, { headers: { "X-Forwarded-For": ip } }));
    const res = await postTo(jar, ip, "/auth/signup", { email: "maildown@example.com", password: PW });

    // The account and session are still real — only the claim changes.
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/account?m=check-email-failed");
    expect(jar.session).toBeDefined();
    expect(accountsService.findUserByEmail(providers, "maildown@example.com")).not.toBeNull();

    const account = await fetch(`${downBase}${res.headers.get("Location")}`, {
      headers: { Cookie: `session=${jar.session}`, "X-Forwarded-For": ip },
    });
    const html = await account.text();
    // Rendered as an alert, not a green check — it is a failure.
    expect(html).toContain(`class="note form-error" role="alert">⚠ Account created — but we couldn't send`);
    expect(html).not.toContain("We sent a verification link");
  });

  test("resend-verify reports the failure too", async () => {
    const jar: Jar = {};
    const ip = "203.0.113.91";
    absorb(jar, await fetch(`${downBase}/signup`, { headers: { "X-Forwarded-For": ip } }));
    await postTo(jar, ip, "/auth/signup", { email: "maildown2@example.com", password: PW });
    absorb(jar, await fetch(`${downBase}/account`, {
      headers: { Cookie: `session=${jar.session}`, "X-Forwarded-For": ip },
    }));
    const res = await postTo(jar, ip, "/auth/resend-verify", {});
    expect(res.headers.get("Location")).toBe("/account?m=verify-failed");
  });
});

// Push routes and the race-day dispatcher (WS-H), end to end over a real
// server plus a stubbed push service.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type { Database } from "bun:sqlite";
import { createServer } from "../src/app/server.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { notificationsService } from "../src/domains/notifications/index.ts";
import type { CandidateAlert } from "../src/domains/notifications/index.ts";
import { b64urlEncode, generateVapidKeys } from "../src/providers/webpush.ts";
import { dispatchAlerts } from "../src/app/push.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { testDb, seedDriver, seedRace, seedResult, seedUser } from "./seed.ts";

const NOW = new Date("2026-09-07T18:00:00Z");
let server: Server<undefined>;
let base: string;
let providers: Providers;
let proCookie: string;
let freeCookie: string;
let proUserId: number;

beforeAll(() => {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedRace(db, { raceId: 100, season: 2024, raceName: "Test 400" });
  seedResult(db, { raceId: 100, driverId: 10, finish: 1, points: 45 });
  providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
  };
  analyticsService.computeAll(providers);
  proUserId = seedUser(db, { email: "pro@example.com" });
  const freeUserId = seedUser(db, { email: "free@example.com" });
  billingService.grantPro(providers, proUserId, "2099-01-01T00:00:00Z", "grant", NOW);
  proCookie = `session=${accountsService.createSession(providers, proUserId, NOW)}`;
  freeCookie = `session=${accountsService.createSession(providers, freeUserId, NOW)}`;
  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => server.stop(true));

const SUB = { endpoint: "https://push.example/device-1", p256dh: "B".repeat(87), auth: "a".repeat(22) };

async function postPush(path: string, body: unknown, cookie?: string, csrf = "tok"): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-CSRF-Token": csrf };
  if (cookie) headers.cookie = `${cookie}; csrf=${csrf}`;
  return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
}

describe("push subscription routes", () => {
  test("the VAPID key endpoint 503s when the deploy has no keys", async () => {
    // The test server has no VAPID env, which is the pre-A2 production state.
    const res = await fetch(`${base}/api/push/key`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "push_not_configured" });
  });

  test("anonymous cannot subscribe", async () => {
    const res = await postPush("/api/push/subscribe", SUB);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sign_in_required" });
  });

  test("a signed-in free account cannot subscribe — push is Pro", async () => {
    const res = await postPush("/api/push/subscribe", SUB, freeCookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pro_required", upgrade: "/pricing" });
  });

  test("a Pro subscription without the CSRF pair is refused", async () => {
    const res = await fetch(`${base}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${proCookie}; csrf=real` , "X-CSRF-Token": "forged" },
      body: JSON.stringify(SUB),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_failed" });
  });

  test("a Pro viewer subscribes and gets the default alert kinds", async () => {
    const res = await postPush("/api/push/subscribe", { ...SUB, followedDriverId: 10, timezone: "America/New_York" }, proCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; kinds: string[]; followedDriverId: number };
    expect(body.ok).toBe(true);
    expect(body.followedDriverId).toBe(10);
    expect(body.kinds).toContain("pit");
    const stored = notificationsService.subscriptionsForUser(providers, proUserId);
    expect(stored.length).toBe(1);
    expect(stored[0]!.timezone).toBe("America/New_York");
  });

  test("malformed subscriptions are rejected with the reason", async () => {
    const res = await postPush("/api/push/subscribe", { ...SUB, endpoint: "http://insecure/x" }, proCookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid_subscription",
      detail: "Push endpoint must be an https URL.",
    });
  });

  test("one account cannot hijack or delete another's endpoint", async () => {
    // proUser already owns device-1 from the subscribe test above.
    const claimed = await postPush("/api/push/subscribe", SUB, freeCookie);
    expect(claimed.status).toBe(403); // free is stopped by the Pro gate first

    const otherPro = seedUser(providers.db, { email: "pro2@example.com" });
    billingService.grantPro(providers, otherPro, "2099-01-01T00:00:00Z", "grant", NOW);
    const otherCookie = `session=${accountsService.createSession(providers, otherPro, NOW)}`;

    const steal = await postPush("/api/push/subscribe", SUB, otherCookie);
    expect(steal.status).toBe(409);
    expect(await steal.json()).toEqual({ error: "endpoint_claimed" });

    const del = await postPush("/api/push/unsubscribe", { endpoint: SUB.endpoint }, otherCookie);
    expect(del.status).toBe(404);
    expect(notificationsService.subscriptionsForUser(providers, proUserId).length).toBe(1);
  });

  test("the owner can unsubscribe their own device", async () => {
    const res = await postPush("/api/push/unsubscribe", { endpoint: SUB.endpoint }, proCookie);
    expect(res.status).toBe(200);
    expect(notificationsService.subscriptionsForUser(providers, proUserId)).toEqual([]);
  });

  test("the Live page offers alerts to Pro and stays quiet for free viewers", async () => {
    const pro = await (await fetch(`${base}/live`, { headers: { cookie: proCookie } })).text();
    expect(pro).toContain('id="push-mount"');
    expect(pro).toContain("/push.js");
    const free = await (await fetch(`${base}/live`, { headers: { cookie: freeCookie } })).text();
    expect(free).not.toContain('id="push-mount"');
    expect(free).not.toContain("/push.js");
  });
});

// --- dispatcher ---

describe("race-day dispatcher", () => {
  let db: Database;
  let p: { db: Database };
  let vapid: Awaited<ReturnType<typeof generateVapidKeys>>;
  let sent: string[];

  const okFetch = (async (url: string | URL | Request) => {
    sent.push(String(url));
    return new Response("", { status: 201 });
  }) as unknown as typeof fetch;

  /**
   * A device with REAL P-256 key material. A placeholder key would make every
   * send fail inside encryptPayload (correctly — it isn't a valid curve
   * point), so the dispatcher would look broken when it is merely refusing
   * to encrypt to nonsense.
   */
  async function device(endpoint: string, driverId: number | null, kinds: string[] = ["pit", "caution"]) {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const userId = seedUser(db, { email: `${endpoint.slice(-8)}@example.com` });
    return notificationsService.subscribe(
      p, userId,
      {
        endpoint,
        p256dh: b64urlEncode(raw),
        auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
        followedDriverId: driverId,
        kinds: kinds as never,
      },
      NOW,
    );
  }

  function alert(over: Partial<CandidateAlert> = {}): CandidateAlert {
    return { kind: "pit", message: "Alpha pits", driverId: 10, atLap: 100, raceId: 100, ...over };
  }

  beforeEach(async () => {
    db = testDb();
    p = { db };
    sent = [];
    vapid = await generateVapidKeys("mailto:owner@example.com");
  });

  test("delivers only to devices following the driver", async () => {
    await device("https://push.example/follows-10", 10);
    await device("https://push.example/follows-99", 99);

    const outcome = await dispatchAlerts(p, [alert()], "Test 400", { vapid, now: () => NOW, fetchImpl: okFetch });

    expect(outcome.sent).toBe(1);
    expect(outcome.skippedFiltered).toBe(1);
    expect(sent).toEqual(["https://push.example/follows-10"]);
  });

  test("a re-derived alert after a feed restart is not sent twice", async () => {
    await device("https://push.example/d1", 10);
    const first = await dispatchAlerts(p, [alert()], "Test 400", { vapid, now: () => NOW, fetchImpl: okFetch });
    const second = await dispatchAlerts(p, [alert({ message: "No. 10 to pit road" })], "Test 400", {
      vapid, now: () => NOW, fetchImpl: okFetch,
    });

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(sent.length).toBe(1);
  });

  test("a global caution reaches every subscriber of that kind", async () => {
    await device("https://push.example/a", 10);
    await device("https://push.example/b", 99);
    await device("https://push.example/c", null, ["pit"]); // not subscribed to caution

    const outcome = await dispatchAlerts(p, [alert({ kind: "caution", driverId: null, message: "Caution" })], "Test 400", {
      vapid, now: () => NOW, fetchImpl: okFetch,
    });

    expect(outcome.sent).toBe(2);
    expect(sent.sort()).toEqual(["https://push.example/a", "https://push.example/b"]);
  });

  test("a dead endpoint is pruned, and the rest of the batch still goes", async () => {
    await device("https://push.example/dead", 10);
    await device("https://push.example/live", 10);
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      sent.push(target);
      return target.includes("dead") ? new Response("gone", { status: 410 }) : new Response("", { status: 201 });
    }) as unknown as typeof fetch;

    const outcome = await dispatchAlerts(p, [alert()], "Test 400", { vapid, now: () => NOW, fetchImpl });

    expect(outcome.sent).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.pruned).toBe(1);
    expect(notificationsService.allSubscriptions(p).map((s) => s.endpoint)).toEqual([
      "https://push.example/live",
    ]);
  });

  test("quiet hours drop the alert instead of queueing it", async () => {
    // A caution from four hours ago is noise, not news.
    const quiet = await device("https://push.example/quiet", 10, ["pit"]);
    notificationsService.subscribe(
      p, quiet.userId,
      {
        endpoint: quiet.endpoint, p256dh: quiet.p256dh, auth: quiet.auth,
        followedDriverId: 10, kinds: ["pit"], quietFromHour: 0, quietToHour: 23, timezone: "UTC",
      },
      NOW,
    );

    const outcome = await dispatchAlerts(p, [alert()], "Test 400", { vapid, now: () => NOW, fetchImpl: okFetch });

    expect(outcome.sent).toBe(0);
    expect(outcome.skippedFiltered).toBe(1);
    expect(sent).toEqual([]);
    // Dropped, not deferred: no claim was recorded either.
    expect(notificationsService.sendCountForRace(p, 100)).toBe(0);
  });

  test("without VAPID keys the dispatcher is a no-op rather than an error", async () => {
    await device("https://push.example/d1", 10);
    const outcome = await dispatchAlerts(p, [alert()], "Test 400", { vapid: null, now: () => NOW, fetchImpl: okFetch });
    expect(outcome).toMatchObject({ sent: 0, considered: 0 });
    expect(sent).toEqual([]);
  });

  test("no alerts means no work", async () => {
    await device("https://push.example/d1", 10);
    const outcome = await dispatchAlerts(p, [], "Test 400", { vapid, now: () => NOW, fetchImpl: okFetch });
    expect(outcome.considered).toBe(0);
  });
});

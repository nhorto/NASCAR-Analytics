// GET /api/me (WS-J): the JSON viewer/entitlement read the mobile app relies
// on, end to end over a real server. Kept out of tests/app.auth.test.ts on
// purpose — that file is being extended by the WS-E billing branch.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNullStripe } from "../src/providers/stripe.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { testDb, seedUser } from "./seed.ts";

const NOW = new Date("2026-09-08T18:00:00Z");
const PRO_UNTIL = "2099-01-01T00:00:00.000Z";
let server: Server<undefined>;
let base: string;
let providers: Providers;
let proCookie: string;
let freeCookie: string;

beforeAll(() => {
  providers = {
    db: testDb(),
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
    stripe: createNullStripe(),
  };
  const proUserId = seedUser(providers.db, { email: "pro@example.com" });
  const freeUserId = seedUser(providers.db, { email: "free@example.com", verified: false });
  billingService.grantPro(providers, proUserId, PRO_UNTIL, "grant", NOW);
  proCookie = `session=${accountsService.createSession(providers, proUserId, NOW)}`;
  freeCookie = `session=${accountsService.createSession(providers, freeUserId, NOW)}`;
  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => server.stop(true));

describe("GET /api/me", () => {
  test("anonymous gets 401 sign_in_required", async () => {
    const res = await fetch(`${base}/api/me`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sign_in_required" });
  });

  test("a garbage session cookie is anonymous, not an error", async () => {
    const res = await fetch(`${base}/api/me`, { headers: { cookie: "session=not-a-real-token" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sign_in_required" });
  });

  test("a signed-in free user reads their own non-Pro state", async () => {
    const res = await fetch(`${base}/api/me`, { headers: { cookie: freeCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "free@example.com",
      verifiedAt: null,
      pro: false,
      proUntil: null,
      proSource: null,
    });
    // Entitlement state is per-user; it must never be cacheable.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("a granted Pro user reads pro with until/source", async () => {
    const res = await fetch(`${base}/api/me`, { headers: { cookie: proCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "pro@example.com",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      pro: true,
      proUntil: PRO_UNTIL,
      proSource: "grant",
    });
  });

  test("non-GET is refused", async () => {
    const res = await fetch(`${base}/api/me`, { method: "POST", headers: { cookie: proCookie } });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
  });
});

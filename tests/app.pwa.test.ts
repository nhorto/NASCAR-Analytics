// PWA shell (WS-H): manifest validity, the served routes, and — most
// importantly — the service worker's caching decisions. The SW tests load and
// evaluate the REAL client/sw.js source (with its config injected exactly as
// the server injects it) rather than a re-implementation, so what's asserted
// is what actually ships to a browser.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import {
  NEVER_CACHE_PREFIXES,
  SHELL_ASSETS,
  serviceWorkerSource,
  webManifest,
} from "../src/app/pwa.ts";
import { testDb, seedDriver, seedRace, seedResult, seedUser } from "./seed.ts";

let server: Server<undefined>;
let base: string;
let providers: Providers;
let proCookie: string;

beforeAll(() => {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedRace(db, { raceId: 100, season: 2024, raceDateUtc: "2024-03-01T18:00:00", raceName: "Test 400" });
  seedResult(db, { raceId: 100, driverId: 10, finish: 1, start: 2, points: 45 });
  providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
  };
  analyticsService.computeAll(providers);
  const userId = seedUser(db, { email: "pro@example.com" });
  billingService.grantPro(providers, userId, "2099-01-01T00:00:00Z", "grant", new Date());
  proCookie = `session=${accountsService.createSession(providers, userId, new Date())}`;
  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => server.stop(true));

describe("web app manifest", () => {
  const manifest = webManifest();

  test("declares the fields a browser requires to offer installation", () => {
    expect(manifest.name).toContain("Looplab");
    expect(manifest.short_name).toBe("Looplab");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#0a0c10");
    expect(manifest.theme_color).toBe("#0a0c10");
  });

  test("ships 192 and 512 icons plus a maskable one", () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; type: string; purpose: string }>;
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    // Without a maskable icon Android crops the artwork into a circle.
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(icons.every((i) => i.type === "image/png")).toBe(true);
    expect(icons.every((i) => i.src.startsWith("/icons/"))).toBe(true);
  });

  test("is served as JSON with the manifest content type", async () => {
    const res = await fetch(`${base}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/manifest+json; charset=utf-8");
    expect(((await res.json()) as { start_url: string }).start_url).toBe("/");
  });
});

describe("PWA routes", () => {
  test("icons are served as real PNGs with the signature intact", async () => {
    for (const name of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
      const res = await fetch(`${base}/icons/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  test("an unknown icon 404s instead of escaping the icons directory", async () => {
    expect((await fetch(`${base}/icons/nope.png`)).status).toBe(404);
    // Path traversal can't be expressed by the route's [a-z0-9-] pattern.
    const traversal = await fetch(`${base}/icons/..%2F..%2Fstyle.css`);
    expect(traversal.status).toBe(404);
  });

  test("the offline page renders and is reachable without a session", async () => {
    const res = await fetch(`${base}/offline`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("You're offline");
    expect(html).toContain("Race data needs a connection");
  });

  test("sw.js is served from the root so its scope covers the site", async () => {
    const res = await fetch(`${base}/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toContain("addEventListener");
  });

  test("the worker and manifest must revalidate, or a deploy can never land", async () => {
    for (const path of ["/sw.js", "/manifest.webmanifest"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
      await res.arrayBuffer();
    }
  });

  test("pages advertise the manifest, theme color and iOS icon", async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('name="theme-color" content="#0a0c10"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">');
    expect(html).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(html).toContain('id="install-card"');
  });

  test("the config injected into the worker is real JSON, not a placeholder", async () => {
    const source = await (await fetch(`${base}/sw.js`)).text();
    expect(source).not.toContain("__SW_CONFIG__");
    const match = /var CONFIG = (\{.*?\});/s.exec(source)!;
    const config = JSON.parse(match[1]!) as { cache: string; shell: string[]; offlineUrl: string };
    expect(config.cache).toStartWith("looplab-shell-");
    expect(config.shell).toEqual(SHELL_ASSETS);
    expect(config.offlineUrl).toBe("/offline");
  });
});

// --- the real service worker, evaluated in a sandbox ---

interface SwHooks {
  classifyRequest(url: URL, method: string, sameOrigin: boolean): string;
  shouldCacheResponse(response: unknown, hasAuthHeader: boolean): boolean;
  config: { cache: string };
}

/** Evaluate the shipped sw.js against a minimal `self`, returning its hooks. */
function loadServiceWorker(): SwHooks {
  const source = serviceWorkerSource("https://live.example.workers.dev");
  const listeners: Record<string, unknown> = {};
  const self = {
    addEventListener: (name: string, fn: unknown) => {
      listeners[name] = fn;
    },
    location: { origin: "https://looplab.test" },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
    __swTestHooks: undefined as unknown,
  };
  const caches = { open: () => Promise.resolve({}), keys: () => Promise.resolve([]), match: () => Promise.resolve(null) };
  new Function("self", "caches", "fetch", "Request", "Response", source)(
    self, caches, () => Promise.reject(new Error("no network in test")), class {}, class {},
  );
  return self.__swTestHooks as SwHooks;
}

/** Minimal stand-in for a fetched Response, with just the headers the SW reads. */
function fakeResponse(opts: {
  ok?: boolean; status?: number; type?: string; headers?: Record<string, string>;
}): unknown {
  const headers = new Headers(opts.headers ?? {});
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    type: opts.type ?? "basic",
    headers,
  };
}

describe("service worker caching policy (real shipped source)", () => {
  const sw = loadServiceWorker();
  const origin = "https://looplab.test";

  test("personalized responses are never stored — the shared-device rule", () => {
    // A signed-in viewer's pages carry `private, no-store` (WS-D). Caching one
    // would serve one user's Pro content to the next person on the device.
    expect(sw.shouldCacheResponse(fakeResponse({ headers: { "Cache-Control": "private, no-store" } }), false)).toBe(false);
    expect(sw.shouldCacheResponse(fakeResponse({ headers: { "Cache-Control": "no-store" } }), false)).toBe(false);
    expect(sw.shouldCacheResponse(fakeResponse({ headers: { "Cache-Control": "PRIVATE, max-age=0" } }), false)).toBe(false);
    expect(sw.shouldCacheResponse(fakeResponse({ headers: { "Set-Cookie": "session=abc" } }), false)).toBe(false);
    expect(sw.shouldCacheResponse(fakeResponse({}), true)).toBe(false); // Authorization header
  });

  test("public, successful responses are stored", () => {
    expect(
      sw.shouldCacheResponse(fakeResponse({ headers: { "Cache-Control": "public, max-age=300" } }), false),
    ).toBe(true);
  });

  test("failures, redirects and opaque responses are never stored", () => {
    expect(sw.shouldCacheResponse(fakeResponse({ ok: false, status: 404 }), false)).toBe(false);
    expect(sw.shouldCacheResponse(fakeResponse({ status: 206 }), false)).toBe(false);
    expect(sw.shouldCacheResponse(fakeResponse({ type: "opaque" }), false)).toBe(false);
    expect(sw.shouldCacheResponse(fakeResponse({ type: "opaqueredirect" }), false)).toBe(false);
    expect(sw.shouldCacheResponse(null, false)).toBe(false);
  });

  test("account, auth and download paths bypass the cache entirely", () => {
    for (const prefix of NEVER_CACHE_PREFIXES) {
      const url = new URL(`${origin}${prefix}anything`);
      expect(sw.classifyRequest(url, "GET", true)).toBe("bypass");
    }
  });

  test("race-critical paths are network-first, the shell is cache-first", () => {
    expect(sw.classifyRequest(new URL(`${origin}/data/season-stats-1.json`), "GET", true)).toBe("network-first");
    expect(sw.classifyRequest(new URL(`${origin}/api/metrics`), "GET", true)).toBe("network-first");
    expect(sw.classifyRequest(new URL(`${origin}/live`), "GET", true)).toBe("network-first");
    expect(sw.classifyRequest(new URL(`${origin}/predictions`), "GET", true)).toBe("network-first");
    expect(sw.classifyRequest(new URL(`${origin}/style.css`), "GET", true)).toBe("cache-first");
    expect(sw.classifyRequest(new URL(`${origin}/drivers/10`), "GET", true)).toBe("cache-first");
  });

  test("non-GET and cross-origin requests are left alone", () => {
    // POSTs mutate; cross-origin includes the live Worker, which must stay live.
    expect(sw.classifyRequest(new URL(`${origin}/auth/signin`), "POST", true)).toBe("bypass");
    expect(sw.classifyRequest(new URL(`${origin}/`), "POST", true)).toBe("bypass");
    expect(sw.classifyRequest(new URL("https://live.example.workers.dev/api/live"), "GET", false)).toBe("bypass");
  });

  test("the cache name is version-keyed so a deploy evicts the old shell", () => {
    expect(sw.config.cache).toStartWith("looplab-shell-");
    expect(sw.config.cache.length).toBeGreaterThan("looplab-shell-".length);
  });
});

describe("PWA and the paid gate", () => {
  test("a Pro page is marked private so the worker refuses to cache it", async () => {
    // The SW policy above is only sound because the server labels these
    // correctly — this asserts the two halves agree.
    const res = await fetch(`${base}/`, { headers: { cookie: proCookie } });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    await res.text();
  });

  test("an anonymous page stays publicly cacheable for the shell", async () => {
    const res = await fetch(`${base}/`);
    expect(res.headers.get("Cache-Control")).toContain("public");
    await res.text();
  });
});

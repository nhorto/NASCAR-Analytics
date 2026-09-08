// The CSP is only as good as the markup: `script-src 'self'` (WS-I) holds
// exactly as long as no page emits an inline <script> body or an on*= handler
// attribute. A header assertion alone would pass while every page silently
// broke, so these tests check the markup itself — both the templates (which
// covers pages this harness has no fixtures to render) and the real responses
// (which covers anything assembled at runtime).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNullStripe } from "../src/providers/stripe.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { headersFile } from "../src/app/export.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop, seedUser } from "./seed.ts";

// fileURLToPath, not `.pathname`: this worktree has a space in its path and
// `.pathname` percent-encodes it into a directory that does not exist.
const APP_DIR = fileURLToPath(new URL("../src/app/", import.meta.url));
const BOOT_JS = readFileSync(join(APP_DIR, "client/boot.js"), "utf8");

/** A <script> element with no src — i.e. one with an inline body. */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>/i;
/** ` onclick=`, ` onsubmit=`, … in an emitted tag. */
const EVENT_HANDLER_ATTR = /\son(?:abort|blur|change|click|error|focus|input|load|submit|keydown|keyup|mouseover|mouseout|paste|reset|scroll|select|toggle)\s*=/i;

let server: Server<undefined>;
let base: string;
let providers: Providers;
let proCookie: string;

beforeAll(() => {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedDriver(db, 11, "Beta Driver");
  seedRace(db, { raceId: 100, season: 2024, raceName: "Test 2024", raceDateUtc: "2024-03-01T18:00:00" });
  seedResult(db, { raceId: 100, driverId: 10, finish: 1, start: 3, lapsLed: 60, points: 45, carNumber: "5" });
  seedResult(db, { raceId: 100, driverId: 11, finish: 2, start: 1, lapsLed: 20, points: 40, carNumber: "9" });
  seedLoop(db, { raceId: 100, driverId: 10, avgPs: 3, passesGf: 40, passedGf: 20, fastLaps: 30, top15Laps: 90, rating: 110 });
  seedLoop(db, { raceId: 100, driverId: 11, avgPs: 6, passesGf: 25, passedGf: 30, fastLaps: 5, top15Laps: 60, rating: 88 });

  providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
    stripe: createNullStripe(),
  };
  analyticsService.computeAll(providers);

  const now = new Date();
  const userId = seedUser(db, { email: "csp@example.com" });
  billingService.grantPro(providers, userId, "2099-01-01T00:00:00Z", "grant", now);
  proCookie = `session=${accountsService.createSession(providers, userId, now)}`;

  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);
});

/** Every .ts under src/app that can emit markup. */
function appTemplates(): Array<{ path: string; source: string }> {
  return readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ path: `src/app/${f}`, source: readFileSync(join(APP_DIR, f), "utf8") }));
}

describe("no inline script anywhere in the templates", () => {
  test("no page template emits a <script> without a src", () => {
    const offenders = appTemplates()
      .filter((f) => INLINE_SCRIPT.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  test("no page template emits an on*= handler attribute", () => {
    const offenders = appTemplates()
      .filter((f) => EVENT_HANDLER_ATTR.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("rendered pages", () => {
  // /live and /dfs need fixtures this harness doesn't seed; the template scan
  // above is what covers them.
  const PATHS = [
    "/",
    "/home",
    "/metrics",
    "/drivers",
    "/drivers/10",
    "/driver/10",
    "/races",
    "/races/2024",
    "/race/100",
    "/recap",
    "/compare",
    "/tracks",
    "/live",
    "/account",
    "/pricing",
    "/offline",
    "/welcome",
    "/nope-404",
  ];

  for (const path of PATHS) {
    test(`${path} has no inline script and no on*= handler`, async () => {
      const res = await fetch(`${base}${path}`, {
        headers: { cookie: proCookie },
        redirect: "manual",
      });
      const html = await res.text();
      expect(html).toStartWith("<!doctype html>");
      expect(INLINE_SCRIPT.test(html), `${path} emitted an inline <script>`).toBe(false);
      expect(EVENT_HANDLER_ATTR.test(html), `${path} emitted an on*= handler`).toBe(false);
    });
  }

  test("the response CSP allows no inline script", async () => {
    const csp = (await fetch(`${base}/`)).headers.get("Content-Security-Policy")!;
    const scriptSrc = /script-src ([^;]+)/.exec(csp)![1]!;
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(scriptSrc.trim()).toBe("'self'");
  });
});

describe("the behavior the markup relies on lives in boot.js", () => {
  test("every data-* hook a template emits is handled", () => {
    const emitted = new Set<string>();
    for (const f of appTemplates()) {
      for (const m of f.source.matchAll(/\bdata-(confirm|nav|print|nosubmit)\b/g)) emitted.add(m[1]!);
    }
    // Guard against the scan silently finding nothing.
    expect([...emitted].sort()).toEqual(["confirm", "nav", "nosubmit", "print"]);
    for (const hook of emitted) {
      expect(BOOT_JS, `boot.js does not handle data-${hook}`).toContain(`data-${hook}`);
    }
  });

  test("boot.js reads the page config off <html> and registers the worker", () => {
    expect(BOOT_JS).toContain("document.documentElement.dataset");
    expect(BOOT_JS).toContain("window.__LIVE_API__");
    expect(BOOT_JS).toContain("window.__SERIES__");
    expect(BOOT_JS).toContain("window.__PRO__");
    expect(BOOT_JS).toContain('navigator.serviceWorker.register("/sw.js")');
  });

  test("the shell publishes the config boot.js expects", async () => {
    const html = await (await fetch(`${base}/xfinity`, { headers: { cookie: proCookie } })).text();
    expect(html).toContain('data-series="2"');
    expect(html).toContain('data-pro="true"');
    expect(html).toMatch(/data-live-api="https?:\/\/[^"]+"/);
    // boot.js must be loaded blocking from <head>: compare.js / tracks.js /
    // live.js are parser-blocking scripts in <main> that read these globals.
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(/<script src="\/boot\.js\?v=[^"]+"><\/script>/);
    expect(head).not.toContain("/boot.js?v=undefined");
  });
});

describe("the static export ships the same headers", () => {
  test("_headers carries the CSP and the rest of the security set", () => {
    const body = headersFile({});
    expect(body).toStartWith("/*\n");
    expect(body).toContain("  Content-Security-Policy: default-src 'self'; script-src 'self';");
    expect(body).toContain("  X-Content-Type-Options: nosniff");
    expect(body).toContain("  X-Frame-Options: DENY");
    expect(body).toContain("  Strict-Transport-Security: max-age=15552000; includeSubDomains");
    expect(body).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  test("plausible is allowed only when the export emits its tag", () => {
    expect(headersFile({})).not.toContain("plausible");
    const withTag = headersFile({ PLAUSIBLE_DOMAIN: "looplab.example" });
    expect(withTag).toContain("script-src 'self' https://plausible.io");
    expect(withTag).toContain("connect-src 'self' https://looplab-live.nhorton.workers.dev https://plausible.io");
  });

  test("the sw.js revalidate rule still comes after /*.js — last match wins", () => {
    const body = headersFile({});
    expect(body.indexOf("/sw.js")).toBeGreaterThan(body.indexOf("/*.js"));
    expect(body.indexOf("/manifest.webmanifest")).toBeGreaterThan(body.indexOf("/*.js"));
  });
});

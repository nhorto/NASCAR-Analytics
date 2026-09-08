// End-to-end WS-G over a real server: CSV export gating and shape, the export
// affordance on pages, email preferences, and the unsubscribe round trip.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNullStripe } from "../src/providers/stripe.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { DATASETS } from "../src/app/datasets.ts";
import * as render from "../src/app/render.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop, seedUser } from "./seed.ts";

let server: Server<undefined>;
let base: string;
let providers: Providers;
let proCookie: string;
let freeCookie: string;
let proUserId: number;
let freeUserId: number;
const NOW = new Date();

beforeAll(() => {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedDriver(db, 11, "Béta Dríver, Jr."); // non-ASCII + comma: the Excel case
  for (const [i, season] of [2023, 2024].entries()) {
    const raceId = 100 + i;
    seedRace(db, { raceId, season, raceName: `Test ${season}`, raceDateUtc: `${season}-03-01T18:00:00` });
    seedResult(db, { raceId, driverId: 10, finish: 1, start: 3, lapsLed: 60, points: 45, carNumber: "5" });
    seedResult(db, { raceId, driverId: 11, finish: 2, start: 1, lapsLed: 20, points: 40, carNumber: "9" });
    seedLoop(db, { raceId, driverId: 10, avgPs: 3, passesGf: 40, passedGf: 20, fastLaps: 30, top15Laps: 90, rating: 110 });
    seedLoop(db, { raceId, driverId: 11, avgPs: 6, passesGf: 25, passedGf: 30, fastLaps: 5, top15Laps: 60, rating: 88 });
  }

  providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
    stripe: createNullStripe(),
  };
  analyticsService.computeAll(providers);

  proUserId = seedUser(db, { email: "pro@example.com" });
  freeUserId = seedUser(db, { email: "free@example.com" });
  billingService.grantPro(providers, proUserId, "2099-01-01T00:00:00Z", "grant", NOW);
  proCookie = `session=${accountsService.createSession(providers, proUserId, NOW)}`;
  freeCookie = `session=${accountsService.createSession(providers, freeUserId, NOW)}`;

  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);
});

function get(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { redirect: "manual", ...init });
}

/** Decode a CSV body keeping the BOM (Response.text() would strip it). */
async function csvText(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

describe("export gating", () => {
  test("anonymous requests are refused with the same body as the JSON gate", async () => {
    const res = await get("/export/standings.csv?series=1&season=2024");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pro_required", upgrade: "/pricing" });
  });

  test("a signed-in free account is refused too — export is a Pro capability", async () => {
    const res = await get("/export/standings.csv", { headers: { cookie: freeCookie } });
    expect(res.status).toBe(403);
  });

  test("every registered dataset is Pro-gated, not just the ones with links", async () => {
    for (const id of Object.keys(DATASETS)) {
      const res = await get(`/export/${id}.csv`);
      expect(res.status).toBe(403);
      await res.arrayBuffer();
    }
  });

  test("a Pro account downloads the file", async () => {
    const res = await get("/export/standings.csv?series=1&season=2024", {
      headers: { cookie: proCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="looplab-cup-standings-2024.csv"',
    );
  });
});

describe("export content", () => {
  test("the file opens as Excel expects: BOM, CRLF, quoted commas, intact accents", async () => {
    const res = await get("/export/standings.csv?series=1&season=2024", {
      headers: { cookie: proCookie },
    });
    const body = await csvText(res);

    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.slice(1).split("\r\n")[0]).toBe(
      "rank,driver_id,driver,season,races,wins,top5s,top10s,dnfs,avg_start,avg_finish," +
        "laps_led,points,playoff_points,loop_races,avg_rating,top15_lap_pct,fast_lap_pct," +
        "pass_efficiency,adj_pass_efficiency,avg_closing_gain,closer_score",
    );
    expect(body).toContain('"Béta Dríver, Jr."');
    expect(body.endsWith("\r\n")).toBe(true);
  });

  test("row count matches the table it came from", async () => {
    const res = await get("/export/race-results.csv?race=100", { headers: { cookie: proCookie } });
    const lines = (await csvText(res)).trim().split("\r\n");
    expect(lines.length).toBe(3); // header + two finishers
    expect(lines[1]).toContain("Alpha Driver");
  });

  test("an unknown dataset names the ones that exist", async () => {
    const res = await get("/export/nope.csv", { headers: { cookie: proCookie } });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; datasets: string[] };
    expect(body.error).toBe("unknown_dataset");
    expect(body.datasets).toContain("standings");
  });

  test("a dataset with a missing or unknown subject is a 404, not an empty file", async () => {
    expect((await get("/export/race-results.csv", { headers: { cookie: proCookie } })).status).toBe(404);
    expect((await get("/export/race-results.csv?race=99999", { headers: { cookie: proCookie } })).status).toBe(404);
  });

  test("downloads are never shared-cached", async () => {
    const res = await get("/export/standings.csv", { headers: { cookie: proCookie } });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    await res.arrayBuffer();
  });

  test("gzip is streamed, not buffered, and round-trips byte-identically", async () => {
    const plain = await csvText(
      await get("/export/season-stats.csv", { headers: { cookie: proCookie } }),
    );
    const res = await get("/export/season-stats.csv", {
      headers: { cookie: proCookie, "Accept-Encoding": "gzip" },
      // decompress: false keeps the raw body so the encoding is observable.
      decompress: false,
    } as RequestInit);
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    const raw = new Uint8Array(await res.arrayBuffer());
    const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Bun.gunzipSync(raw));
    expect(decoded).toBe(plain);
  });

  test("an invalid series falls back to Cup rather than exporting another series", async () => {
    const res = await get("/export/standings.csv?series=99", { headers: { cookie: proCookie } });
    expect(res.headers.get("Content-Disposition")).toContain("looplab-cup-standings");
    await res.arrayBuffer();
  });
});

describe("export affordance on pages", () => {
  test("Pro pages carry real download links", async () => {
    const html = await (await get("/", { headers: { cookie: proCookie } })).text();
    expect(html).toContain('href="/export/standings.csv?series=1"');
    expect(html).toContain("Export CSV");
  });

  test("free pages show the upsell instead of the link", async () => {
    const html = await (await get("/", { headers: { cookie: freeCookie } })).text();
    expect(html).not.toContain("/export/standings.csv");
    expect(html).toContain("⭳ Export CSV — Pro");
    expect(html).toContain('href="/pricing"');
  });

  test("anonymous visitors on the server see the upsell (they can reach /pricing)", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain("⭳ Export CSV — Pro");
    expect(html).not.toContain("/export/standings.csv");
  });

  test("the static export renders no export bar — it has no /pricing to link to", () => {
    // export.ts calls the render functions without a viewer, which is the
    // `null` case: a dead upsell link on the static fallback is worse than
    // no affordance at all.
    const html = render.renderHome(providers, 1);
    expect(html).not.toContain("export-bar");
    expect(render.renderTracks(providers, 1)).toContain('data-pro="false"');
  });

  test("the race log and career links carry the driver they belong to", async () => {
    const html = await (await get("/drivers/10", { headers: { cookie: proCookie } })).text();
    expect(html).toContain("/export/driver-log.csv?series=1&amp;driver=10");
    expect(html).toContain("/export/career.csv?driver=10");
  });
});

describe("compare and track-explorer shells", () => {
  test("Pro gets four compare slots and the season range", async () => {
    const html = await (await get("/compare", { headers: { cookie: proCookie } })).text();
    expect(html).toContain('id="cmp-c"');
    expect(html).toContain('id="cmp-d"');
    expect(html).toContain('id="cmp-season-to"');
    expect(html).toContain('data-pro="true"');
  });

  test("free keeps two slots, one season, and an upsell", async () => {
    const html = await (await get("/compare", { headers: { cookie: freeCookie } })).text();
    expect(html).toContain('id="cmp-a"');
    expect(html).toContain('id="cmp-b"');
    expect(html).not.toContain('id="cmp-c"');
    expect(html).not.toContain('id="cmp-season-to"');
    expect(html).toContain('data-pro="false"');
    expect(html).toContain("Compare up to four drivers");
  });

  test("the track explorer tells its client whether the viewer may export", async () => {
    expect(await (await get("/tracks", { headers: { cookie: proCookie } })).text()).toContain(
      'data-pro="true"',
    );
    expect(await (await get("/tracks")).text()).toContain('data-pro="false"');
  });
});

describe("email preferences and unsubscribe", () => {
  /** Sign in as a browser would: fetch the page to pick up the csrf cookie. */
  async function csrfFor(cookie: string): Promise<{ csrf: string; cookie: string }> {
    const res = await get("/account", { headers: { cookie } });
    const html = await res.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const set = res.headers.getSetCookie().find((c) => c.startsWith("csrf="));
    return { csrf, cookie: set ? `${cookie}; csrf=${csrf}` : cookie };
  }

  test("the account page offers both lists, off by default", async () => {
    const res = await get("/account", { headers: { cookie: proCookie } });
    const html = await res.text();
    expect(html).toContain('name="recap"');
    expect(html).toContain('name="preview"');
    expect(html).not.toContain("checked");
  });

  test("saving preferences turns the named lists on", async () => {
    const { csrf, cookie } = await csrfFor(proCookie);
    const res = await fetch(`${base}/auth/email-prefs`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, recap: "on" }),
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    const prefs = accountsService.emailPrefs(providers, proUserId, NOW);
    expect(prefs.recap).toBe(true);
    expect(prefs.preview).toBe(false);
  });

  test("preferences require the CSRF pair like every other account form", async () => {
    const res = await fetch(`${base}/auth/email-prefs`, {
      method: "POST",
      headers: { cookie: proCookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: "forged", recap: "on" }),
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });

  test("the unsubscribe link works from the email, signed out, and offers undo", async () => {
    accountsService.setEmailPref(providers, freeUserId, "recap", true, NOW);
    const token = accountsService.emailPrefs(providers, freeUserId, NOW).unsubToken;

    const res = await get(`/unsubscribe/${token}?list=recap`); // no session cookie
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Unsubscribed");
    expect(accountsService.emailPrefs(providers, freeUserId, NOW).recap).toBe(false);

    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("csrf="))!;
    const undo = await fetch(`${base}/auth/resubscribe`, {
      method: "POST",
      headers: { cookie: `csrf=${csrf}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, token, list: "recap" }),
      redirect: "manual",
    });
    expect(setCookie).toContain("HttpOnly");
    expect(undo.status).toBe(200);
    expect(await undo.text()).toContain("back on the list");
    expect(accountsService.emailPrefs(providers, freeUserId, NOW).recap).toBe(true);
  });

  test("a forged token or a missing list name changes nothing", async () => {
    const unknown = await get("/unsubscribe/not-a-real-token?list=recap");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("Link not recognized");

    const token = accountsService.emailPrefs(providers, freeUserId, NOW).unsubToken;
    const noList = await get(`/unsubscribe/${token}`);
    expect(noList.status).toBe(400);
    expect(accountsService.emailPrefs(providers, freeUserId, NOW).recap).toBe(true);
  });

  test("unsubscribe pages are never cached", async () => {
    const token = accountsService.emailPrefs(providers, freeUserId, NOW).unsubToken;
    const res = await get(`/unsubscribe/${token}?list=preview`);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    await res.text();
  });
});

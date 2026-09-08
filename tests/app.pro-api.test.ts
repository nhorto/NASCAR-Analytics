// GET /api/predictions + GET /api/dfs (WS-J): the JSON views the native app
// reads, end to end over a real server. The point of these tests is that the
// JSON carries the *same* gating verdicts as the HTML pages in
// tests/app.predictions.test.ts — a free viewer must never receive a withheld
// prediction row, and DFS must stay Pro-only in full.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { predictionsService, type ScoringRules } from "../src/domains/predictions/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop, seedUser } from "./seed.ts";

// The model run is dated to sit between the seeded races; sessions and grants
// use the real clock, because the server resolves viewers against it and a
// session minted in the seeded past would already have expired.
const RUN_AT = new Date("2026-06-08T12:00:00Z");
const NOW = new Date();
const DRIVERS = ["Ace Driver", "Second Driver", "Third Driver", "Fourth Driver", "Fifth Driver"];

// The projections the handler serves are scored with the *real*
// config/dfs/*.json; these are only what the seeded run stores.
const RULES: ScoringRules[] = [
  { platform: "dk", finishPoints: Array.from({ length: 40 }, (_, i) => 45 - i), lapLedPoints: 0.25, fastLapPoints: 0.45, placeDiffPoints: 1 },
  { platform: "fd", finishPoints: Array.from({ length: 40 }, (_, i) => 43 - i), lapLedPoints: 0.1, fastLapPoints: 0, placeDiffPoints: 0.5 },
];

let server: Server<undefined>;
let base: string;
let providers: Providers;
let proCookie: string;

/** A server with a fully seeded, predicted Cup race. */
function seededProviders(): Providers {
  const db = testDb();
  DRIVERS.forEach((name, i) => seedDriver(db, i + 1, name));
  for (let i = 0; i < 4; i++) {
    const raceId = 100 + i;
    seedRace(db, { raceId, season: 2026, raceDateUtc: `2026-05-0${i + 1}T18:00:00` });
    DRIVERS.forEach((_, d) => {
      seedResult(db, { raceId, driverId: d + 1, finish: d + 1, start: d + 1, lapsLed: d === 0 ? 80 : 0 });
      seedLoop(db, { raceId, driverId: d + 1, avgPs: d + 2, rating: 130 - d * 20, fastLaps: d === 0 ? 15 : 2 });
    });
  }
  seedRace(db, {
    raceId: 200,
    season: 2026,
    raceTypeId: null,
    raceName: "Target 400",
    raceDateUtc: "2026-06-10T18:00:00",
  });
  return {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
  };
}

beforeAll(() => {
  providers = seededProviders();
  analyticsService.computeAll(providers);
  predictionsService.generatePredictions(providers, {
    raceId: 200,
    stage: "thursday",
    now: RUN_AT,
    scoringRules: RULES,
  });
  const proUserId = seedUser(providers.db, { email: "pro@example.com" });
  billingService.grantPro(providers, proUserId, "2099-01-01T00:00:00.000Z", "grant", NOW);
  proCookie = `session=${accountsService.createSession(providers, proUserId, NOW)}`;
  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => server.stop(true));

async function get(path: string, cookie?: string) {
  const res = await fetch(`${base}${path}`, cookie ? { headers: { cookie } } : undefined);
  return { status: res.status, cacheControl: res.headers.get("Cache-Control"), body: await res.json() };
}

describe("GET /api/predictions", () => {
  test("a free viewer gets three rows and a count of what is withheld", async () => {
    const { status, body } = await get("/api/predictions");
    expect(status).toBe(200);
    const b = body as Record<string, any>;
    expect(b.viewerPro).toBe(false);
    expect(b.rows.length).toBe(3);
    expect(b.hiddenCount).toBe(DRIVERS.length - 3);
    // The withheld rows must not be serialized at all — the whole point of
    // the teaser rule is that they never reach a non-Pro client.
    expect(JSON.stringify(body)).not.toContain("Fourth Driver");
    expect(JSON.stringify(body)).not.toContain("Fifth Driver");
  });

  test("a Pro viewer gets the whole field, the stamp, and the basis race", async () => {
    const { status, body } = await get("/api/predictions", proCookie);
    expect(status).toBe(200);
    const b = body as Record<string, any>;
    expect(b.viewerPro).toBe(true);
    expect(b.hiddenCount).toBe(0);
    expect(b.rows.length).toBe(DRIVERS.length);
    expect(b.rows.map((r: any) => r.fullName)).toContain("Fifth Driver");
    expect(b.race).toMatchObject({ raceName: "Target 400", season: 2026, hasResults: false });
    expect(b.stage).toBe("thursday");
    expect(b.basisRaceId).toBe(103);
    expect(typeof b.generatedAt).toBe("string");
  });

  test("probabilities come through as numbers, sorted by win chance", async () => {
    const { body } = await get("/api/predictions", proCookie);
    const rows = (body as Record<string, any>).rows as Array<Record<string, number>>;
    for (const row of rows) {
      expect(row.pWin).toBeGreaterThanOrEqual(0);
      expect(row.pWin).toBeLessThanOrEqual(1);
      expect(Number.isFinite(row.expFinish)).toBe(true);
    }
    expect(rows[0]!.pWin).toBeGreaterThanOrEqual(rows[rows.length - 1]!.pWin!);
  });

  test("the honesty-bar numbers ride along so the app cannot quote stale ones", async () => {
    const { body } = await get("/api/predictions");
    const m = (body as Record<string, any>).methodology;
    expect(m.evalSeason).toBe(2025);
    expect(m.winBrier).toContain("0.0255");
    expect(m.calibrationNote).toContain("standard error");
  });

  test("entitlement-shaped responses are never shared-cacheable", async () => {
    expect((await get("/api/predictions", proCookie)).cacheControl).toBe("private, no-store");
  });

  test("another series is refused for free and Cup-only for Pro (D16)", async () => {
    const free = await get("/api/predictions?series=2");
    expect(free.status).toBe(403);
    expect(free.body).toEqual({ error: "pro_required", upgrade: "/pricing" });
    const pro = await get("/api/predictions?series=2", proCookie);
    expect(pro.status).toBe(404);
    expect(pro.body).toEqual({ error: "cup_only" });
  });

  test("non-GET is refused", async () => {
    const res = await fetch(`${base}/api/predictions`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
  });
});

describe("GET /api/dfs", () => {
  test("a free viewer gets the Pro gate, not projections", async () => {
    const { status, body } = await get("/api/dfs");
    expect(status).toBe(403);
    expect(body).toEqual({ error: "pro_required", upgrade: "/pricing" });
  });

  test("Pro gets DraftKings projections ordered by projected points", async () => {
    const { status, body } = await get("/api/dfs", proCookie);
    expect(status).toBe(200);
    const b = body as Record<string, any>;
    expect(b.platform).toBe("dk");
    expect(b.race).toMatchObject({ raceName: "Target 400" });
    expect(b.rows.length).toBe(DRIVERS.length);
    const points = b.rows.map((r: any) => r.projectedPoints);
    expect([...points].sort((x: number, y: number) => y - x)).toEqual(points);
  });

  test("the scoring summary is read from config/dfs, not hard-coded", async () => {
    const dk = await get("/api/dfs", proCookie);
    expect((dk.body as any).scoring).toEqual({
      platform: "dk",
      winPoints: 45,
      lapLedPoints: 0.25,
      fastLapPoints: 0.45,
      placeDiffPoints: 1,
    });
    const fd = await get("/api/dfs?scoring=fd", proCookie);
    expect((fd.body as any).platform).toBe("fd");
    expect((fd.body as any).scoring).toEqual({
      platform: "fd",
      winPoints: 43,
      lapLedPoints: 0.1,
      fastLapPoints: 0,
      placeDiffPoints: 0.5,
    });
  });

  test("an unknown scoring platform falls back to DraftKings", async () => {
    const { body } = await get("/api/dfs?scoring=nonsense", proCookie);
    expect((body as any).platform).toBe("dk");
  });

  test("another series is Cup-only for Pro and gated for free (D16)", async () => {
    expect((await get("/api/dfs?series=3")).status).toBe(403);
    const pro = await get("/api/dfs?series=3", proCookie);
    expect(pro.status).toBe(404);
    expect(pro.body).toEqual({ error: "cup_only" });
  });
});

describe("with no stored prediction run", () => {
  let empty: Server<undefined>;
  let emptyBase: string;

  beforeAll(() => {
    const p = seededProviders();
    analyticsService.computeAll(p);
    const userId = seedUser(p.db, { email: "pro2@example.com" });
    billingService.grantPro(p, userId, "2099-01-01T00:00:00.000Z", "grant", NOW);
    empty = createServer(p, 0);
    emptyBase = empty.url.toString().replace(/\/$/, "");
  });

  afterAll(() => empty.stop(true));

  test("predictions answer 200 with a null race rather than an error", async () => {
    const res = await fetch(`${emptyBase}/api/predictions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.race).toBeNull();
    expect(body.rows).toEqual([]);
    // The off-season app still needs the honesty-bar copy for its methodology
    // screen, so it must survive the empty case.
    expect(body.methodology.evalSeason).toBe(2025);
  });
});

describe("predicted vs actual", () => {
  test("once results land the rows carry the actual finish", async () => {
    seedResult(providers.db, { raceId: 200, driverId: 5, finish: 1 });
    seedResult(providers.db, { raceId: 200, driverId: 1, finish: 2 });
    const { body } = await get("/api/predictions", proCookie);
    const b = body as Record<string, any>;
    expect(b.race.hasResults).toBe(true);
    const byName = new Map(b.rows.map((r: any) => [r.fullName, r.actualFinish]));
    expect(byName.get("Fifth Driver")).toBe(1);
    expect(byName.get("Ace Driver")).toBe(2);
    // A driver with no result row stays null rather than defaulting to a place.
    expect(byName.get("Third Driver")).toBeNull();
  });
});

// End-to-end WS-F pages: /predictions (free top-3 teaser vs Pro full table,
// generation stamp, predicted-vs-actual), /dfs (Pro-only, DK/FD toggle),
// /predictions/methodology, and the Cup-only note for other series.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { predictionsService, type ScoringRules } from "../src/domains/predictions/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNullHibp } from "../src/providers/hibp.ts";
import { createNullStripe } from "../src/providers/stripe.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop } from "./seed.ts";

let server: Server<undefined>;
let base: string;
let providers: Providers;
let proCookie: string;

const RULES: ScoringRules[] = [
  { platform: "dk", finishPoints: Array.from({ length: 40 }, (_, i) => 45 - i), lapLedPoints: 0.25, fastLapPoints: 0.45, placeDiffPoints: 1 },
  { platform: "fd", finishPoints: Array.from({ length: 40 }, (_, i) => 43 - i), lapLedPoints: 0.1, fastLapPoints: 0, placeDiffPoints: 0.5 },
];

beforeAll(async () => {
  const db = testDb();
  const names = ["Ace Driver", "Second Driver", "Third Driver", "Fourth Driver", "Fifth Driver"];
  names.forEach((name, i) => seedDriver(db, i + 1, name));
  for (let i = 0; i < 4; i++) {
    const raceId = 100 + i;
    seedRace(db, { raceId, season: 2026, raceDateUtc: `2026-05-0${i + 1}T18:00:00` });
    names.forEach((_, d) => {
      seedResult(db, { raceId, driverId: d + 1, finish: d + 1, start: d + 1, lapsLed: d === 0 ? 80 : 0 });
      seedLoop(db, { raceId, driverId: d + 1, avgPs: d + 2, rating: 130 - d * 20, fastLaps: d === 0 ? 15 : 2 });
    });
  }
  // The predicted race: upcoming, schedule-style NULL race type.
  seedRace(db, { raceId: 200, season: 2026, raceTypeId: null, raceName: "Target 400", raceDateUtc: "2026-06-10T18:00:00" });

  providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
    hibp: createNullHibp(),
    stripe: createNullStripe(),
  };
  analyticsService.computeAll(providers);
  predictionsService.generatePredictions(providers, {
    raceId: 200, stage: "thursday", now: new Date("2026-06-08T12:00:00Z"), scoringRules: RULES,
  });

  const signup = await accountsService.signUp(providers, "pro@example.com", "sturdy-pro-password-1", new Date());
  if (!signup.ok) throw new Error(signup.reason);
  billingService.grantPro(providers, signup.user.userId, "2099-01-01T00:00:00Z", "grant", new Date());
  proCookie = `session=${accountsService.createSession(providers, signup.user.userId, new Date())}`;

  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);
});

async function get(path: string, cookie?: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${base}${path}`, cookie ? { headers: { cookie } } : undefined);
  return { status: res.status, body: await res.text() };
}

describe("/predictions", () => {
  test("free viewers see the top three, a blur, and the upgrade CTA", async () => {
    const { status, body } = await get("/predictions");
    expect(status).toBe(200);
    expect(body).toContain("Target 400");
    expect(body).toContain("Ace Driver");
    expect(body).toContain("Third Driver");
    expect(body).not.toContain("Fourth Driver"); // hidden rows never rendered
    expect(body).toContain("more drivers with Pro");
    expect(body).toContain('href="/pricing"');
    expect(body).toContain("pred-free");
  });

  test("Pro viewers get every row, the stamp, and the basis race", async () => {
    const { body } = await get("/predictions", proCookie);
    expect(body).toContain("Fourth Driver");
    expect(body).toContain("Fifth Driver");
    expect(body).not.toContain("pred-free");
    expect(body).toContain("built from data through race 103");
    expect(body).toContain("form-based (Thursday)");
    expect(body).toContain("/predictions/methodology");
  });

  test("after the race is ingested, the page shows predicted vs actual", async () => {
    // Ingest results for the target race (upset winner) — the *stored*
    // prediction must not change, only gain the Actual column.
    seedResult(providers.db, { raceId: 200, driverId: 5, finish: 1 });
    seedResult(providers.db, { raceId: 200, driverId: 1, finish: 2 });
    const { body } = await get("/predictions", proCookie);
    expect(body).toContain("predicted vs actual");
    expect(body).toContain("<th>Actual</th>");
  });

  test("methodology page states the honesty bar with real backtest numbers", async () => {
    const { status, body } = await get("/predictions/methodology");
    expect(status).toBe(200);
    expect(body).toContain("held-out 2025");
    expect(body).toContain("0.0255");
    expect(body).toContain("simulation frequencies");
  });

  test("other series get the Cup-only note (D16), behind the usual Pro gate", async () => {
    const pro = await get("/xfinity/predictions", proCookie);
    expect(pro.body).toContain("fast-follow");
    const anon = await get("/xfinity/predictions");
    expect(anon.body).toContain("teaser-lock"); // series teaser still first
  });
});

describe("/dfs", () => {
  test("free viewers get the locked card, not projections", async () => {
    const { status, body } = await get("/dfs");
    expect(status).toBe(200);
    expect(body).toContain("Pro feature");
    expect(body).not.toContain("Proj DraftKings");
  });

  test("Pro gets the DK table by default and FD via the toggle", async () => {
    const dk = await get("/dfs", proCookie);
    expect(dk.body).toContain("Proj DraftKings pts");
    expect(dk.body).toContain("Ace Driver");
    expect(dk.body).toContain("Print cheat sheet");
    const fd = await get("/dfs?scoring=fd", proCookie);
    expect(fd.body).toContain("Proj FanDuel pts");
  });
});

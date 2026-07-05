// End-to-end: seeded in-memory db -> computeAll -> real Bun.serve on port 0 -> fetch pages + API.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../src/app/server.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { createNullArchive } from "../src/providers/raw-archive.ts";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";
import type { Providers } from "../src/providers/index.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop } from "./seed.ts";

let server: Server<undefined>;
let base: string;

beforeAll(() => {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedDriver(db, 20, "Beta Racer");
  seedRace(db, {
    raceId: 100,
    season: 2024,
    raceDateUtc: "2024-03-01T18:00:00",
    raceName: "Test 400",
  });
  seedRace(db, {
    raceId: 101,
    season: 2024,
    trackType: "road",
    raceDateUtc: "2024-03-08T18:00:00",
    raceName: "Road Grand Prix",
  });
  seedResult(db, { raceId: 100, driverId: 10, finish: 1, start: 3, lapsLed: 80, points: 50, teamName: "Hendrick Motorsports", carNumber: "5" });
  seedResult(db, { raceId: 100, driverId: 20, finish: 2, start: 1, points: 45, teamName: "Joe Gibbs Racing", carNumber: "20" });
  seedResult(db, { raceId: 101, driverId: 10, finish: 4, start: 2, points: 35, teamName: "Hendrick Motorsports", carNumber: "5" });
  seedResult(db, { raceId: 101, driverId: 20, finish: 1, start: 5, lapsLed: 40, points: 55, teamName: "Joe Gibbs Racing", carNumber: "20" });
  seedLoop(db, { raceId: 100, driverId: 10, avgPs: 2, passesGf: 5, passedGf: 3, rating: 120 });
  seedLoop(db, { raceId: 100, driverId: 20, avgPs: 3, passesGf: 4, passedGf: 4, rating: 100 });
  seedLoop(db, { raceId: 101, driverId: 10, avgPs: 4, passesGf: 6, passedGf: 2, rating: 95 });
  seedLoop(db, { raceId: 101, driverId: 20, avgPs: 2, passesGf: 7, passedGf: 1, rating: 130, fastLaps: 12 });

  const providers: Providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
  };
  analyticsService.computeAll(providers);
  server = createServer(providers, 0);
  base = server.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);
});

async function get(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.text() };
}

describe("web app", () => {
  test("home page renders latest race, standings, and form", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    expect(body).toContain("Road Grand Prix"); // latest completed race
    expect(body).toContain("Beta Racer"); // its winner
    expect(body).toContain("Championship");
  });

  test("stylesheet is served", async () => {
    const { status, body } = await get("/style.css");
    expect(status).toBe(200);
    expect(body).toContain("--accent");
  });

  test("drivers index lists and filters", async () => {
    const all = await get("/drivers");
    expect(all.status).toBe(200);
    expect(all.body).toContain("Alpha Driver");
    expect(all.body).toContain("Beta Racer");
    const filtered = await get("/drivers?q=alpha");
    expect(filtered.body).toContain("Alpha Driver");
    expect(filtered.body).not.toContain("Beta Racer");
  });

  test("driver profile shows stats and race log", async () => {
    const { status, body } = await get("/drivers/10");
    expect(status).toBe(200);
    expect(body).toContain("Alpha Driver");
    expect(body).toContain("Adj Pass Efficiency");
    expect(body).toContain("Test 400");
  });

  test("unknown driver 404s", async () => {
    const { status } = await get("/drivers/9999");
    expect(status).toBe(404);
  });

  test("race page renders results and loop insights", async () => {
    const { status, body } = await get("/races/101");
    expect(status).toBe(200);
    expect(body).toContain("Road Grand Prix");
    expect(body).toContain("Beta Racer");
    expect(body).toContain("Loop Insights");
  });

  test("races index lists the season", async () => {
    const { status, body } = await get("/races?season=2024");
    expect(status).toBe(200);
    expect(body).toContain("Test 400");
    expect(body).toContain("Road Grand Prix");
  });

  test("compare renders both drivers with metrics", async () => {
    const { status, body } = await get("/compare?a=10&b=20&season=2024");
    expect(status).toBe(200);
    expect(body).toContain("Alpha Driver");
    expect(body).toContain("Beta Racer");
    expect(body).toContain("Adj Pass Eff");
  });

  test("tracks explorer renders a leaderboard", async () => {
    const { status, body } = await get("/tracks?type=road&from=2024&min=1");
    expect(status).toBe(200);
    expect(body).toContain("Beta Racer");
  });

  test("unknown path returns styled 404", async () => {
    const { status } = await get("/nope");
    expect(status).toBe(404);
  });

  test("JSON API: drivers, driver, stats, standings, tracks", async () => {
    const json = async (path: string) =>
      (await fetch(`${base}${path}`).then((r) => r.json())) as any;

    const idx = await json("/api/drivers");
    expect(idx.drivers.length).toBe(2);

    const one = await json("/api/drivers/10");
    expect(one.driver.fullName).toBe("Alpha Driver");
    expect(one.raceLog.length).toBe(2);

    const stats = await json("/api/drivers/10/stats");
    expect(stats.seasons.length).toBe(1);
    expect(stats.seasons[0].season).toBe(2024);

    const standings = await json("/api/standings/2024");
    expect(standings.standings[0].fullName).toBe("Beta Racer"); // 100 vs 85 points

    const tracks = await json("/api/tracks?type=road&from=2024&min=1");
    expect(tracks.leaders.length).toBe(2);

    const bad = await fetch(`${base}/api/drivers/xyz`);
    expect(bad.status).toBe(400);
  });
});

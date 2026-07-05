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

  // A second series (Xfinity = 2) with its own race + driver, to exercise the switcher.
  seedDriver(db, 30, "Xfinity Only");
  seedRace(db, {
    raceId: 200,
    season: 2024,
    seriesId: 2,
    raceDateUtc: "2024-03-05T18:00:00",
    raceName: "Xfinity 250",
  });
  seedResult(db, { raceId: 200, driverId: 30, finish: 1, start: 2, lapsLed: 60, points: 48, teamName: "JR Motorsports", carNumber: "88" });
  seedLoop(db, { raceId: 200, driverId: 30, avgPs: 3, passesGf: 5, passedGf: 4, rating: 110 });

  const providers: Providers = {
    db,
    cdn: createNascarCdnClient({ delayMs: 0, retries: 0, retryBaseDelayMs: 0, userAgent: "test" }),
    archive: createNullArchive(),
  };
  analyticsService.computeAll(providers); // Cup
  analyticsService.computeAll(providers, 2); // Xfinity
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

  test("race page (un-prefixed /race/:id) renders results and loop insights", async () => {
    const { status, body } = await get("/race/101");
    expect(status).toBe(200);
    expect(body).toContain("Road Grand Prix");
    expect(body).toContain("Beta Racer");
    expect(body).toContain("Loop Insights");
  });

  test("races index and per-season path both list the season", async () => {
    const latest = await get("/races");
    expect(latest.status).toBe(200);
    expect(latest.body).toContain("Road Grand Prix");
    const bySeason = await get("/races/2024");
    expect(bySeason.status).toBe(200);
    expect(bySeason.body).toContain("Test 400");
  });

  test("compare is a client shell backed by season-stats JSON", async () => {
    const shell = await get("/compare");
    expect(shell.status).toBe(200);
    expect(shell.body).toContain("/compare.js");
    const data = (await fetch(`${base}/data/season-stats-1.json`).then((r) => r.json())) as any[];
    expect(data.some((d) => d.name === "Alpha Driver")).toBe(true);
    expect(data.some((d) => d.name === "Beta Racer")).toBe(true);
  });

  test("tracks is a client shell backed by track-type JSON", async () => {
    const shell = await get("/tracks");
    expect(shell.status).toBe(200);
    expect(shell.body).toContain("/tracks.js");
    const data = (await fetch(`${base}/data/tracktype-1.json`).then((r) => r.json())) as any[];
    expect(data.some((d) => d.type === "road")).toBe(true);
  });

  test("client JS assets are served", async () => {
    expect((await get("/compare.js")).body).toContain("season-stats-");
    expect((await get("/tracks.js")).body).toContain("tracktype-");
  });

  test("unknown path returns styled 404", async () => {
    const { status } = await get("/nope");
    expect(status).toBe(404);
  });

  test("series switcher renders all three series", async () => {
    const { body } = await get("/");
    expect(body).toContain("series-switch");
    expect(body).toContain("Xfinity");
    expect(body).toContain("Trucks");
  });

  test("path-based series: /xfinity shows Xfinity data, not Cup data", async () => {
    const cup = await get("/drivers");
    expect(cup.body).toContain("Alpha Driver");
    expect(cup.body).not.toContain("Xfinity Only");

    const xf = await get("/xfinity/drivers");
    expect(xf.status).toBe(200);
    expect(xf.body).toContain("Xfinity Only");
    expect(xf.body).not.toContain("Alpha Driver");
    // Tabs and links carry the series via the path prefix.
    expect(xf.body).toContain("/xfinity/drivers");
  });

  test("Xfinity home surfaces the Xfinity race and standings", async () => {
    const { status, body } = await get("/xfinity");
    expect(status).toBe(200);
    expect(body).toContain("Xfinity 250");
    expect(body).toContain("Xfinity Only");
  });

  test("race page derives its own series for the switcher", async () => {
    const { status, body } = await get("/race/200");
    expect(status).toBe(200);
    expect(body).toContain("Xfinity 250");
    // Switcher/tabs reflect Xfinity even though /race/:id is un-prefixed.
    expect(body).toContain("/xfinity/drivers");
  });

  test("JSON API is series-aware", async () => {
    const xf = (await fetch(`${base}/api/drivers?series=2`).then((r) => r.json())) as any;
    expect(xf.seriesId).toBe(2);
    expect(xf.drivers.some((d: any) => d.fullName === "Xfinity Only")).toBe(true);
    expect(xf.drivers.some((d: any) => d.fullName === "Alpha Driver")).toBe(false);
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

    // Non-numeric driver id no longer matches the route → 404 (not 400).
    const bad = await fetch(`${base}/api/drivers/xyz`);
    expect(bad.status).toBe(404);
  });
});

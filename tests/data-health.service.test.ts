import { describe, expect, test } from "bun:test";
import { dataHealthService } from "../src/domains/data-health/index.ts";
import type { HealthCheck } from "../src/domains/data-health/index.ts";
import { buildChecks, runCanary } from "../src/app/canary.ts";
import type { ScheduledRace } from "../src/domains/data-ingestion/index.ts";

const { expectArray, expectArrayAt, expectKeys, expectNormalizes, all, runChecks, summarize, formatReport } =
  dataHealthService;

describe("data-health validators", () => {
  test("expectArray accepts arrays at or above the minimum and rejects everything else", () => {
    expect(expectArray(1)([1])).toBeNull();
    expect(expectArray(0)([])).toBeNull();
    expect(expectArray(1)([])).toBe("expected ≥ 1 element(s), got 0");
    expect(expectArray(1)({})).toBe("expected an array, got object");
    expect(expectArray(1)(null)).toBe("expected an array, got null");
  });

  test("expectKeys reports every missing key, in order, and rejects non-objects", () => {
    expect(expectKeys(["a", "b"])({ a: 1, b: null })).toBeNull();
    expect(expectKeys(["a", "b"])({ a: 1 })).toBe("missing key(s): b");
    expect(expectKeys(["a", "b"])({})).toBe("missing key(s): a, b");
    expect(expectKeys(["a"])([])).toBe("expected an object, got array[0]");
  });

  test("expectArrayAt checks a nested array with a minimum length", () => {
    expect(expectArrayAt("laps", 1)({ laps: [{}] })).toBeNull();
    expect(expectArrayAt("laps", 1)({ laps: [] })).toBe('expected "laps" to have ≥ 1 element(s), got 0');
    expect(expectArrayAt("laps", 1)({ laps: null })).toBe('expected "laps" to be an array, got null');
    expect(expectArrayAt("laps")("x")).toBe("expected an object, got string");
  });

  test("expectNormalizes passes when the normalizer yields rows and reports throws or empties", () => {
    expect(expectNormalizes(() => [1, 2])(null)).toBeNull();
    expect(expectNormalizes(() => [])(null)).toBe("normalizer produced 0 row(s), expected ≥ 1");
    expect(
      expectNormalizes(() => {
        throw new Error("bad shape");
      })(null),
    ).toBe("normalizer threw: bad shape");
  });

  test("all() returns the first problem and null when every validator passes", () => {
    const v = all(expectArray(1), () => "second");
    expect(v([])).toBe("expected ≥ 1 element(s), got 0");
    expect(v([1])).toBe("second");
    expect(all(expectArray(0))([])).toBeNull();
  });
});

describe("data-health runner", () => {
  const checks: HealthCheck[] = [
    { id: "ok", label: "ok", url: "https://x/ok", validate: expectArray(1) },
    { id: "http", label: "http", url: "https://x/403", validate: expectArray(1) },
    { id: "shape", label: "shape", url: "https://x/shape", validate: expectKeys(["vehicles"]) },
    { id: "boom", label: "boom", url: "https://x/boom", validate: expectArray(1) },
  ];
  const fetcher = async (url: string) => {
    if (url.endsWith("/ok")) return { status: 200, json: [1] };
    if (url.endsWith("/403")) return { status: 403, json: null };
    if (url.endsWith("/shape")) return { status: 200, json: { race_id: 1 } };
    throw new Error("connection reset");
  };

  test("classifies HTTP, shape, and transport failures distinctly and counts them", async () => {
    let t = 1000;
    const report = await runChecks(checks, fetcher, () => (t += 5));
    expect(report.results.map((r) => r.ok)).toEqual([true, false, false, false]);
    expect(report.results[1]).toMatchObject({ status: 403, problem: "HTTP 403" });
    expect(report.results[2]).toMatchObject({ status: 200, problem: "missing key(s): vehicles" });
    expect(report.results[3]).toMatchObject({ status: 0, problem: "transport: connection reset" });
    expect(report.failures).toBe(3);
    expect(report.healthy).toBe(false);
    // Each check measured its own elapsed time from the injected clock.
    expect(report.results.every((r) => r.ms === 5)).toBe(true);
  });

  test("a fully green run is healthy with zero failures", async () => {
    const report = await runChecks([checks[0]!], fetcher);
    expect(report).toMatchObject({ failures: 0, healthy: true });
    expect(report.results).toHaveLength(1);
  });

  test("summarize + formatReport produce one line per check and a verdict", () => {
    const report = summarize(
      [
        { id: "a", label: "schedule-feed", url: "https://x/a", status: 200, ok: true, problem: null, ms: 12 },
        { id: "b", label: "loopstats", url: "https://x/b", status: 403, ok: false, problem: "HTTP 403", ms: 30 },
      ],
      "2026-09-07T12:00:00.000Z",
    );
    const text = formatReport(report);
    expect(text.startsWith("canary 2026-09-07T12:00:00.000Z")).toBe(true);
    expect(text).toContain("✓ schedule-feed");
    expect(text).toContain("200 in 12 ms");
    expect(text).toContain("✗ loopstats");
    expect(text).toContain("HTTP 403 (30 ms)");
    expect(text.endsWith("1 of 2 checks FAILED")).toBe(true);
    expect(formatReport(summarize([report.results[0]!], report.at)).endsWith("all 1 checks healthy")).toBe(true);
  });
});

describe("canary check list", () => {
  const race: ScheduledRace = {
    raceId: 5617,
    seriesId: 1,
    season: 2026,
    trackId: 99,
    trackName: "Sonoma Raceway",
    raceName: "Toyota/Save Mart 350",
    startTimeUtc: "2026-06-28T19:30:00",
  };

  test("targets the given race on every per-race endpoint plus both live feeds", () => {
    const checks = buildChecks(race, 2026, 1);
    expect(checks.map((c) => c.id)).toEqual(["schedule", "weekend", "loopstats", "laptimes", "live-feed", "live-flags"]);
    expect(checks[1]!.url).toBe("https://cf.nascar.com/cacher/2026/1/5617/weekend-feed.json");
    expect(checks[2]!.url).toBe("https://cf.nascar.com/loopstats/prod/2026/1/5617.json");
    expect(checks[3]!.url).toBe("https://cf.nascar.com/cacher/2026/1/5617/lap-times.json");
    expect(checks[4]!.url).toBe("https://cf.nascar.com/live/feeds/live-feed.json");
  });

  test("validators accept the real captured fixtures and reject the CDN's known null-body failure mode", async () => {
    const checks = Object.fromEntries(buildChecks(race, 2026, 1).map((c) => [c.id, c]));
    const fx = async (n: string) => (await Bun.file(new URL(`./fixtures/${n}.json`, import.meta.url)).json()) as unknown;
    expect(checks.schedule!.validate(await fx("schedule-feed"))).toBeNull();
    expect(checks.weekend!.validate(await fx("weekend-feed"))).toBeNull();
    expect(checks.loopstats!.validate(await fx("loopstats"))).toBeNull();
    expect(checks.laptimes!.validate(await fx("lap-times"))).toBeNull();
    expect(checks["live-feed"]!.validate(await fx("live-feed"))).toBeNull();
    expect(checks["live-flags"]!.validate(await fx("live-flag-data"))).toBeNull();
    // 2016–2017 loopstats answer HTTP 200 with a literal null body.
    expect(checks.loopstats!.validate(null)).toBe("expected an array, got null");
    // A weekend feed with `weekend_race: null` (the 2025 YellaWood 500 hole).
    expect(checks.weekend!.validate({ weekend_race: null, weekend_runs: [] })).toBe(
      "normalizer produced 0 row(s), expected ≥ 1",
    );
  });
});

describe("runCanary end to end (injected transport)", () => {
  const fixture = async (n: string) =>
    (await Bun.file(new URL(`./fixtures/${n}.json`, import.meta.url)).json()) as unknown;
  // Between the Sonoma race (2026-06-28 19:30Z + 6 h) and the championship race in the fixture.
  const midSeason = () => Date.parse("2026-09-07T12:00:00Z");

  test("a green CDN yields six healthy checks aimed at the latest completed race", async () => {
    const seen: string[] = [];
    const report = await runCanary({
      seriesId: 1,
      now: midSeason,
      fetchJson: async (url) => {
        seen.push(url);
        if (url.includes("schedule-feed")) return { status: 200, json: await fixture("schedule-feed") };
        if (url.includes("weekend-feed")) return { status: 200, json: await fixture("weekend-feed") };
        if (url.includes("loopstats")) return { status: 200, json: await fixture("loopstats") };
        if (url.includes("lap-times")) return { status: 200, json: await fixture("lap-times") };
        if (url.endsWith("live-feed.json")) return { status: 200, json: await fixture("live-feed") };
        if (url.endsWith("live-flag-data.json")) return { status: 200, json: await fixture("live-flag-data") };
        throw new Error(`unexpected url ${url}`);
      },
    });
    expect(report.healthy).toBe(true);
    expect(report.results).toHaveLength(6);
    // Sonoma (5617) is the latest completed race; the championship race has not run yet.
    expect(report.results[1]!.url).toBe("https://cf.nascar.com/cacher/2026/1/5617/weekend-feed.json");
    // The schedule was fetched once to pick the race, then once more as a check.
    expect(seen.filter((u) => u.includes("schedule-feed"))).toHaveLength(2);
  });

  test("an unreachable schedule is reported as the single failing check, not thrown", async () => {
    const report = await runCanary({
      seriesId: 1,
      now: midSeason,
      fetchJson: async () => ({ status: 403, json: null }),
    });
    expect(report.healthy).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      id: "schedule",
      status: 403,
      ok: false,
      problem: "HTTP 403",
      // Both seasons were tried; the last attempt (previous season) is what is reported.
      url: "https://cf.nascar.com/cacher/2025/1/schedule-feed.json",
    });
  });

  test("a schedule with no completed race (preseason) is a reported failure too", async () => {
    const report = await runCanary({
      seriesId: 1,
      now: () => Date.parse("2026-01-15T12:00:00Z"),
      fetchJson: async (url) =>
        url.includes("/2026/") ? { status: 403, json: null } : { status: 200, json: [] },
    });
    expect(report.results[0]).toMatchObject({ status: 200, problem: "schedule has no completed race yet" });
  });
});

// Phase 4 hardening: race-window keep-warm helpers + the post-race
// authoritative loopstats swap. Pure functions only (the DO/cron are thin
// adapters over these).
import { describe, expect, test } from "bun:test";
import {
  anyRaceInWindow,
  applyAuthoritativeStats,
  parseScheduleUtc,
  raceHasFinished,
} from "../src/domains/live/service.ts";
import { applyAuthoritative } from "../src/domains/live/runtime.ts";
import { KEEPWARM_POST_RACE_MS, KEEPWARM_PRE_RACE_MS } from "../src/domains/live/config.ts";
import type {
  LiveBaselines,
  LiveDriverRow,
  LivePayload,
  LiveSnapshot,
  LoopStatsRace,
} from "../src/domains/live/types.ts";
import loopstatsFixture from "./fixtures/loopstats.json";

function mkDriver(over: Partial<LiveDriverRow> & { driverId: number; position: number }): LiveDriverRow {
  return {
    carNumber: String(over.position),
    driverName: `Driver ${over.driverId}`,
    manufacturer: null,
    gapToLeader: 0,
    lastLapSpeed: null,
    bestLapSpeed: null,
    avgRunningPosition: over.position,
    lapsLed: 0,
    lapsCompleted: 0,
    starting: null,
    passesMade: 0,
    timesPassed: 0,
    passingDifferential: 0,
    qualityPasses: 0,
    positionDiffLast10Pct: 0,
    fastestLapsRun: 0,
    pitStopCount: 0,
    isOnTrack: true,
    running: true,
    livePassEfficiency: null,
    adjPassEfficiency: null,
    closerEstimate: null,
    ...over,
  };
}

function mkSnap(over: Partial<LiveSnapshot> & { drivers: LiveDriverRow[] }): LiveSnapshot {
  return {
    raceId: 5617,
    seriesId: 1,
    runName: "Test 400",
    trackName: "Test",
    trackLength: 1.5,
    lap: 110,
    lapsInRace: 110,
    lapsToGo: 0,
    elapsedTime: 0,
    flag: "checkered",
    flagState: 5,
    stage: null,
    cautionSegments: 0,
    leadChanges: 0,
    numberOfLeaders: 1,
    isLive: false,
    ...over,
  };
}

const officialRace = (loopstatsFixture as LoopStatsRace[])[0]!; // race 5617: drivers 4469 + 4228

const baselines: LiveBaselines = {
  seriesId: 1,
  bucketWidth: 5,
  passEffByBucket: { "0": 0.5, "1": 0.48 },
  closerByBucket: { "0": 1.0, "1": 0.5 },
};

// ---- schedule window ----

describe("parseScheduleUtc", () => {
  test("keeps an explicit UTC marker and tolerates a missing one", () => {
    expect(parseScheduleUtc("2026-07-05T22:00:00Z")).toBe(Date.parse("2026-07-05T22:00:00Z"));
    // The schedule feed's "YYYY-MM-DD HH:MM:SS" (no zone) is treated as UTC.
    expect(parseScheduleUtc("2026-07-05 22:00:00")).toBe(Date.parse("2026-07-05T22:00:00Z"));
  });
  test("NaN on garbage", () => {
    expect(Number.isNaN(parseScheduleUtc("not a date"))).toBe(true);
  });
});

describe("anyRaceInWindow", () => {
  const start = Date.parse("2026-07-05T22:00:00Z");
  const races = [
    { race_name: "eero 400", start_time_utc: "2026-07-05 22:00:00" },
    { race_name: "bad row", start_time_utc: null },
    "not even an object",
  ];

  test("true from (start − pre) through (start + post)", () => {
    expect(anyRaceInWindow(races, start - KEEPWARM_PRE_RACE_MS + 1)).toBe(true);
    expect(anyRaceInWindow(races, start)).toBe(true);
    expect(anyRaceInWindow(races, start + KEEPWARM_POST_RACE_MS - 1)).toBe(true);
  });
  test("false outside the window", () => {
    expect(anyRaceInWindow(races, start - KEEPWARM_PRE_RACE_MS - 60_000)).toBe(false);
    expect(anyRaceInWindow(races, start + KEEPWARM_POST_RACE_MS + 60_000)).toBe(false);
  });
  test("false on an empty/garbage schedule", () => {
    expect(anyRaceInWindow([], Date.now())).toBe(false);
    expect(anyRaceInWindow([{}, null, 42], Date.now())).toBe(false);
  });
});

describe("raceHasFinished", () => {
  test("checkered finishes; cold only with full distance complete", () => {
    expect(raceHasFinished(mkSnap({ drivers: [], flag: "checkered" }))).toBe(true);
    expect(raceHasFinished(mkSnap({ drivers: [], flag: "cold", lap: 110, lapsInRace: 110 }))).toBe(true);
  });
  test("pre-race cold (lap 0) and live flags do NOT finish", () => {
    expect(raceHasFinished(mkSnap({ drivers: [], flag: "cold", lap: 0, lapsInRace: 110 }))).toBe(false);
    expect(raceHasFinished(mkSnap({ drivers: [], flag: "green", isLive: true, lap: 50 }))).toBe(false);
  });
  test("no race id ⇒ never finished", () => {
    expect(raceHasFinished(mkSnap({ drivers: [], raceId: 0, flag: "checkered" }))).toBe(false);
  });
});

// ---- authoritative swap ----

describe("applyAuthoritativeStats", () => {
  const snap = mkSnap({
    drivers: [
      // Live feed ended with 4228 ahead of 4469 — the official ps flips them.
      mkDriver({ driverId: 4228, position: 1, passesMade: 99, timesPassed: 1 }),
      mkDriver({ driverId: 4469, position: 2, passesMade: 1, timesPassed: 99 }),
      mkDriver({ driverId: 9999, position: 3, livePassEfficiency: 0.25 }),
    ],
  });

  test("swaps counters + metrics to the official loopstats math and adopts the official order", () => {
    const out = applyAuthoritativeStats(snap, officialRace, baselines);
    expect(out).not.toBeNull();
    const rows = out!.drivers;

    // Official finish order: 4469 ps=1, 4228 ps=2.
    expect(rows[0]!.driverId).toBe(4469);
    expect(rows[0]!.position).toBe(1);
    expect(rows[1]!.driverId).toBe(4228);
    expect(rows[1]!.position).toBe(2);

    // 4469: passes_gf 17, passed_gf 25 → eff 17/42; avg_ps 2.07 → bucket 0.
    const d = rows[0]!;
    expect(d.passesMade).toBe(17);
    expect(d.timesPassed).toBe(25);
    expect(d.passingDifferential).toBe(-8);
    expect(d.qualityPasses).toBe(12);
    expect(d.fastestLapsRun).toBe(24);
    expect(d.lapsLed).toBe(74);
    expect(d.livePassEfficiency).toBeCloseTo(17 / 42, 6);
    expect(d.adjPassEfficiency).toBeCloseTo((17 / 42 - 0.5) * 100, 4);
    // closing_ps 1 → bucket 0 baseline 1.0; closing_laps_diff 0 → closer −1.0.
    expect(d.closerEstimate).toBeCloseTo(-1.0, 6);
  });

  test("drivers missing from loopstats keep their live values", () => {
    const out = applyAuthoritativeStats(snap, officialRace, baselines)!;
    const kept = out.drivers.find((d) => d.driverId === 9999)!;
    expect(kept.livePassEfficiency).toBe(0.25);
    expect(kept.position).toBe(3);
  });

  test("without baselines the residual metrics go null, counters still swap", () => {
    const out = applyAuthoritativeStats(snap, officialRace, null)!;
    const d = out.drivers.find((x) => x.driverId === 4469)!;
    expect(d.passesMade).toBe(17);
    expect(d.adjPassEfficiency).toBeNull();
    expect(d.closerEstimate).toBeNull();
  });

  test("null on a race mismatch or an empty official payload", () => {
    expect(applyAuthoritativeStats(mkSnap({ drivers: [], raceId: 1234 }), officialRace, baselines)).toBeNull();
    expect(applyAuthoritativeStats(snap, { race_id: 5617, drivers: [] }, baselines)).toBeNull();
  });
});

describe("runtime applyAuthoritative", () => {
  test("marks the payload authoritative and re-derives field leaders from official rows", () => {
    const snap = mkSnap({
      drivers: [
        mkDriver({ driverId: 4228, position: 1 }),
        mkDriver({ driverId: 4469, position: 2 }),
      ],
    });
    const payload: LivePayload = {
      ok: true,
      live: false,
      fetchedAt: 123,
      snapshot: snap,
      alerts: [],
      pitCycles: [],
      movers: { gaining: [], fading: [] },
      battles: [],
      fieldLeaders: [],
      nextRace: null,
      trackStrategy: null,
    };
    const out = applyAuthoritative(payload, officialRace, baselines);
    expect(out).not.toBeNull();
    expect(out!.authoritative).toBe(true);
    expect(out!.snapshot.drivers[0]!.driverId).toBe(4469);
    // Field leaders recomputed from the official counters (fast laps: 4469 has 24).
    const fast = out!.fieldLeaders.find((f) => f.key === "fastLaps");
    expect(fast?.driverId).toBe(4469);
    expect(fast?.value).toBe(24);
    // Alerts/history lineage untouched.
    expect(out!.alerts).toEqual([]);
  });

  test("null passes through on mismatch (caller keeps live estimates)", () => {
    const payload = {
      ok: true, live: false, fetchedAt: 1,
      snapshot: mkSnap({ drivers: [], raceId: 42 }),
      alerts: [], pitCycles: [], movers: { gaining: [], fading: [] },
      battles: [], fieldLeaders: [], nextRace: null, trackStrategy: null,
    } as LivePayload;
    expect(applyAuthoritative(payload, officialRace, baselines)).toBeNull();
  });
});

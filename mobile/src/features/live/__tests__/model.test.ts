// Live payload parsing + board view-model, over a fixture shaped like the
// Worker's /api/live (src/domains/live/types.ts in the server repo).
import { describe, expect, test } from "bun:test";
import { parseLiveStatus } from "../api.ts";

describe("parseLiveStatus", () => {
  test("true only when the payload says live:true", () => {
    expect(parseLiveStatus({ live: true })).toBe(true);
    expect(parseLiveStatus({ live: false })).toBe(false);
    expect(parseLiveStatus({})).toBe(false);
    expect(parseLiveStatus(null)).toBe(false);
    expect(parseLiveStatus("live")).toBe(false);
  });
});

import { parseLivePayload } from "../api.ts";
import { formatGap, liveModel, staleness } from "../model.ts";

const NOW = 1_760_000_000_000;

const livePayload = {
  ok: true,
  live: true,
  fetchedAt: NOW - 2_000,
  snapshot: {
    raceId: 5555,
    seriesId: 1,
    runName: "Cook Out 400",
    trackName: "Martinsville Speedway",
    lap: 187,
    lapsInRace: 400,
    lapsToGo: 213,
    flag: "green",
    flagState: 1,
    stage: { num: 2, finishAtLap: 260, lapsInStage: 130 },
    isLive: true,
    drivers: [
      // Deliberately out of order — the parser must sort by position.
      {
        position: 2, carNumber: "11", driverId: 4030, driverName: "Denny Hamlin",
        gapToLeader: 0.482, lastLapSpeed: 96.4, lapsLed: 12, pitStopCount: 2, running: true,
      },
      {
        position: 1, carNumber: "5", driverId: 4025, driverName: "Kyle Larson",
        gapToLeader: 0, lastLapSpeed: 96.8, lapsLed: 101, pitStopCount: 2, running: true,
      },
      {
        position: 36, carNumber: "77", driverId: 4100, driverName: "Crashed Out",
        gapToLeader: 0, lastLapSpeed: null, lapsLed: 0, pitStopCount: 1, running: false,
      },
      { position: -1, driverName: "", carNumber: "?" }, // junk row → dropped
    ],
  },
  alerts: [],
  nextRace: null,
  trackStrategy: null,
};

describe("parseLivePayload", () => {
  test("parses, sorts by position, and drops junk rows", () => {
    const data = parseLivePayload(livePayload);
    expect(data).not.toBeNull();
    expect(data!.live).toBe(true);
    expect(data!.snapshot!.drivers.map((d) => d.position)).toEqual([1, 2, 36]);
    expect(data!.snapshot!.drivers[0]!.driverName).toBe("Kyle Larson");
  });

  test("refuses non-ok and garbage payloads", () => {
    expect(parseLivePayload({ ok: false })).toBeNull();
    expect(parseLivePayload("html error page")).toBeNull();
    expect(parseLivePayload(null)).toBeNull();
  });
});

describe("liveModel", () => {
  test("renders the board with gap/lap/stage formatting", () => {
    const model = liveModel(parseLivePayload(livePayload), NOW);
    expect(model.kind).toBe("board");
    if (model.kind !== "board") return;
    expect(model.header.flag).toBe("GREEN");
    expect(model.header.lapLine).toBe("Lap 187/400 · 213 to go");
    expect(model.header.stageLine).toBe("Stage 2 ends lap 260");
    expect(model.header.staleness).toBeNull(); // 2 s old — fresh
    expect(model.rows[0]!.gap).toBe("Leader");
    expect(model.rows[1]!.gap).toBe("+0.482s");
    expect(model.rows[2]!.gap).toBe("OUT");
    expect(model.rows[2]!.out).toBe(true);
    expect(model.rows[1]!.lastLap).toBe("96.4 mph");
    expect(model.rows[2]!.lastLap).toBe("—");
  });

  test("idle state carries the next race when nothing is on track", () => {
    const idle = parseLivePayload({
      ok: true,
      live: false,
      fetchedAt: NOW,
      snapshot: null,
      nextRace: { seriesId: 1, name: "Gateway 400", trackName: "WWT Raceway", startTimeUtc: "2026-09-13T19:00:00Z" },
    });
    const model = liveModel(idle, NOW);
    expect(model.kind).toBe("idle");
    if (model.kind !== "idle") return;
    expect(model.headline).toBe("No Cup session on track");
    expect(model.detail).toContain("Gateway 400");
    expect(model.detail).toContain("WWT Raceway");
  });

  test("warming and unreachable states are distinct", () => {
    expect(liveModel(parseLivePayload({ ok: true, live: false, warming: true, fetchedAt: 0 }), NOW)).toMatchObject({
      kind: "idle",
      headline: "Live board is warming up…",
    });
    expect(liveModel(null, NOW)).toEqual({ kind: "unavailable" });
  });
});

describe("staleness", () => {
  test("silent when fresh, labeled when stale", () => {
    expect(staleness(NOW - 3_000, NOW)).toBeNull();
    expect(staleness(NOW - 42_000, NOW)).toBe("as of 42s ago");
    expect(staleness(0, NOW)).toBeNull(); // no timestamp → no lie
  });
});

describe("formatGap", () => {
  test("leader, chaser, and out-of-race forms", () => {
    const base = {
      carNumber: "1", driverId: 1, driverName: "X", lastLapSpeed: null,
      lapsLed: 0, pitStopCount: 0,
    };
    expect(formatGap({ ...base, position: 1, gapToLeader: 0, running: true })).toBe("Leader");
    expect(formatGap({ ...base, position: 4, gapToLeader: 1.5, running: true })).toBe("+1.500s");
    expect(formatGap({ ...base, position: 30, gapToLeader: 0, running: false })).toBe("OUT");
  });
});

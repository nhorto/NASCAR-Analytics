// DFS parsing, the config-driven scoring line, and the lineup scratchpad.
import { describe, expect, test } from "bun:test";
import { parseDfs, type DfsRow } from "../api.ts";
import {
  displayRows,
  lineupSummary,
  pruneSelection,
  scoringLine,
  stampLine,
  toggleDriver,
} from "../model.ts";

const DK_ENVELOPE = {
  race: { raceId: 200, raceName: "Target 400", season: 2026 },
  platform: "dk",
  scoring: { platform: "dk", winPoints: 45, lapLedPoints: 0.25, fastLapPoints: 0.45, placeDiffPoints: 1 },
  stage: "thursday",
  generatedAt: "2026-06-08T12:00:00.000Z",
  rows: [
    { driverId: 1, fullName: "Ace Driver", projectedStart: 2, projectedPoints: 61.25 },
    { driverId: 2, fullName: "Second Driver", projectedStart: null, projectedPoints: 48.5 },
    { driverId: 3, fullName: "Third Driver", projectedStart: 11, projectedPoints: 40.05 },
  ],
};

describe("parseDfs", () => {
  test("reads the projections envelope", () => {
    const data = parseDfs(DK_ENVELOPE, "dk")!;
    expect(data.platform).toBe("dk");
    expect(data.race!.raceName).toBe("Target 400");
    expect(data.rows.length).toBe(3);
    expect(data.scoring!.lapLedPoints).toBe(0.25);
  });

  test("the Pro-gate body is not a usable payload", () => {
    expect(parseDfs({ error: "pro_required", upgrade: "/pricing" }, "dk")).toBeNull();
  });

  test("an empty run keeps the requested platform so the toggle stays put", () => {
    const data = parseDfs({ race: null, platform: "fd", scoring: null, rows: [] }, "fd")!;
    expect(data.platform).toBe("fd");
    expect(data.race).toBeNull();
    expect(data.rows).toEqual([]);
  });

  test("a nonsense platform falls back to what was asked for", () => {
    expect(parseDfs({ ...DK_ENVELOPE, platform: "sleeper" }, "fd")!.platform).toBe("fd");
  });
});

describe("scoringLine", () => {
  test("DraftKings names every rule that scores", () => {
    expect(scoringLine(parseDfs(DK_ENVELOPE, "dk")!.scoring)).toBe(
      "45 for the win · 0.25 / lap led · 0.45 / fast lap · 1 / place gained",
    );
  });

  test("a rule worth nothing on this platform is omitted, not printed as zero", () => {
    // FanDuel pays nothing for fastest laps (config/dfs/fd.json).
    const fd = scoringLine({
      platform: "fd",
      winPoints: 43,
      lapLedPoints: 0.1,
      fastLapPoints: 0,
      placeDiffPoints: 0.5,
    });
    expect(fd).toBe("43 for the win · 0.1 / lap led · 0.5 / place gained");
    expect(fd).not.toContain("fast lap");
  });

  test("no scoring config means no claim about scoring", () => {
    expect(scoringLine(null)).toBeNull();
  });
});

describe("stampLine", () => {
  test("names the race, the run stage, and when it was generated", () => {
    const line = stampLine(parseDfs(DK_ENVELOPE, "dk")!);
    expect(line).toContain("Target 400");
    expect(line).toContain("form-based run");
    expect(line).toContain("2026");
  });

  test("a Saturday run says so", () => {
    expect(stampLine(parseDfs({ ...DK_ENVELOPE, stage: "saturday" }, "dk")!)).toContain(
      "post-qualifying run",
    );
  });
});

describe("the lineup scratchpad", () => {
  const rows = parseDfs(DK_ENVELOPE, "dk")!.rows;

  test("tapping adds in pick order and tapping again removes", () => {
    let selected = toggleDriver([], 3);
    selected = toggleDriver(selected, 1);
    expect(selected).toEqual([3, 1]);
    expect(toggleDriver(selected, 3)).toEqual([1]);
  });

  test("the total is the sum of the picks, rounded to a tenth", () => {
    const summary = lineupSummary(rows, [1, 3]);
    expect(summary.count).toBe(2);
    expect(summary.points).toBe(101.3);
    expect(summary.drivers.map((d) => d.fullName)).toEqual(["Ace Driver", "Third Driver"]);
  });

  test("an empty lineup totals nothing rather than NaN", () => {
    expect(lineupSummary(rows, [])).toEqual({ count: 0, points: 0, drivers: [] });
  });

  test("a pick that is no longer in the run does not count toward the total", () => {
    // Switching platforms or rolling to a new race week can strand an id.
    expect(lineupSummary(rows, [1, 999]).points).toBe(61.3);
    expect(pruneSelection(rows, [1, 999, 3])).toEqual([1, 3]);
  });

  test("no drivers are silently dropped when every pick is still live", () => {
    expect(pruneSelection(rows, [3, 2, 1])).toEqual([3, 2, 1]);
  });
});

describe("displayRows", () => {
  test("ranks, formats, and flags the picks", () => {
    const rows: DfsRow[] = parseDfs(DK_ENVELOPE, "dk")!.rows;
    const display = displayRows(rows, [2]);
    expect(display[0]).toMatchObject({ rank: 1, name: "Ace Driver", start: "2", points: "61.3" });
    expect(display[1]).toMatchObject({ rank: 2, picked: true, start: "—" });
    expect(display[2]!.picked).toBe(false);
  });
});

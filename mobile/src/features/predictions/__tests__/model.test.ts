// Predictions parsing + view-model over server-shaped fixtures. The envelopes
// below are what tests/app.pro-api.test.ts asserts the server sends.
import { describe, expect, test } from "bun:test";
import { parsePredictions } from "../api.ts";
import {
  displayRows,
  expectationLine,
  isEmpty,
  provenance,
  stageLabel,
  title,
  winPct,
  withheldLabel,
} from "../model.ts";

function row(name: string, over: Record<string, unknown> = {}) {
  return {
    driverId: name.length + (over.driverId as number | undefined ?? 0),
    fullName: name,
    startPos: 4,
    pWin: 0.21,
    pTop5: 0.55,
    pTop10: 0.78,
    expFinish: 8.44,
    expLapsLed: 31.6,
    expFastLaps: 12.2,
    actualFinish: null,
    ...over,
  };
}

const PRO_ENVELOPE = {
  race: { raceId: 200, raceName: "Target 400", season: 2026, trackType: "intermediate", hasResults: false },
  stage: "thursday",
  generatedAt: "2026-06-08T12:00:00.000Z",
  basisRaceId: 103,
  viewerPro: true,
  hiddenCount: 0,
  rows: [row("Ace Driver", { driverId: 1 }), row("Second Driver", { driverId: 2, pWin: 0.04 })],
  methodology: {
    evalSeason: 2025,
    winBrier: "0.0255 vs 0.0268",
    top10Brier: "0.173 vs 0.194",
    calibrationNote: "inside ±5 points",
  },
};

const FREE_ENVELOPE = {
  ...PRO_ENVELOPE,
  viewerPro: false,
  hiddenCount: 35,
  rows: PRO_ENVELOPE.rows.slice(0, 1),
};

describe("parsePredictions", () => {
  test("reads the Pro envelope whole", () => {
    const parsed = parsePredictions(PRO_ENVELOPE)!;
    expect(parsed.viewerPro).toBe(true);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.race!.raceName).toBe("Target 400");
    expect(parsed.basisRaceId).toBe(103);
    expect(parsed.methodology!.evalSeason).toBe(2025);
  });

  test("the gate bodies are not mistaken for an empty run", () => {
    // `{error: …}` has no rows array; returning null makes the screen show
    // "could not reach the server" instead of "no predictions this week".
    expect(parsePredictions({ error: "pro_required", upgrade: "/pricing" })).toBeNull();
    expect(parsePredictions({ error: "cup_only" })).toBeNull();
    expect(parsePredictions(null)).toBeNull();
  });

  test("an off-season response parses to a real, empty run", () => {
    const parsed = parsePredictions({
      race: null,
      rows: [],
      hiddenCount: 0,
      viewerPro: false,
      methodology: PRO_ENVELOPE.methodology,
    })!;
    expect(isEmpty(parsed)).toBe(true);
    expect(parsed.methodology!.evalSeason).toBe(2025);
  });

  test("junk rows drop out instead of poisoning the table", () => {
    const parsed = parsePredictions({ ...PRO_ENVELOPE, rows: [row("Ace", { driverId: 1 }), { fullName: 7 }, null] })!;
    expect(parsed.rows.length).toBe(1);
  });

  test("a non-finite probability reads as zero, not NaN", () => {
    const parsed = parsePredictions({ ...PRO_ENVELOPE, rows: [row("Ace", { driverId: 1, pWin: "nope" })] })!;
    expect(parsed.rows[0]!.pWin).toBe(0);
  });
});

describe("withheldLabel", () => {
  test("a free viewer is told exactly how many drivers are behind the lock", () => {
    expect(withheldLabel(parsePredictions(FREE_ENVELOPE)!)).toBe("35 more drivers with Pro");
  });

  test("one withheld driver is singular", () => {
    expect(withheldLabel(parsePredictions({ ...FREE_ENVELOPE, hiddenCount: 1 })!)).toBe(
      "1 more driver with Pro",
    );
  });

  test("a Pro viewer never sees the lock", () => {
    expect(withheldLabel(parsePredictions(PRO_ENVELOPE)!)).toBeNull();
    // Nor does a free viewer whose whole (tiny) field fit in the free slice.
    expect(withheldLabel(parsePredictions({ ...FREE_ENVELOPE, hiddenCount: 0 })!)).toBeNull();
  });
});

describe("titles and provenance", () => {
  test("the title changes once the race has been scored", () => {
    expect(title(parsePredictions(PRO_ENVELOPE)!)).toBe("Target 400 — predictions");
    const scored = { ...PRO_ENVELOPE, race: { ...PRO_ENVELOPE.race, hasResults: true } };
    expect(title(parsePredictions(scored)!)).toBe("Target 400 — predicted vs actual");
  });

  test("provenance names the stage and the basis race", () => {
    const line = provenance(parsePredictions(PRO_ENVELOPE)!);
    expect(line).toContain("form-based (Thursday)");
    expect(line).toContain("built from data through race 103");
    expect(line).toContain("2026");
  });

  test("a missing basis race is stated, not hidden", () => {
    expect(provenance(parsePredictions({ ...PRO_ENVELOPE, basisRaceId: null })!)).toContain(
      "through race ?",
    );
  });

  test("stage labels match the web's wording", () => {
    expect(stageLabel("saturday")).toBe("post-qualifying (Saturday)");
    expect(stageLabel("thursday")).toBe("form-based (Thursday)");
    expect(stageLabel(null)).toBe("unstaged");
  });
});

describe("winPct", () => {
  test("long-shot odds keep a decimal so the back half of the field is readable", () => {
    expect(winPct(0.004)).toBe("0.4%");
    expect(winPct(0.099)).toBe("9.9%");
  });

  test("real contenders round to whole percent, like the web", () => {
    expect(winPct(0.21)).toBe("21%");
    expect(winPct(0.1)).toBe("10%");
    expect(winPct(null)).toBe("—");
  });
});

describe("displayRows", () => {
  test("ranks follow the server's order and cells format", () => {
    const rows = displayRows(parsePredictions(PRO_ENVELOPE)!);
    expect(rows[0]).toMatchObject({ rank: 1, name: "Ace Driver", win: "21%", top5: "55%", exp: "8.4" });
    expect(rows[1]!.win).toBe("4.0%");
  });

  test("before the race there is no actual column content", () => {
    expect(displayRows(parsePredictions(PRO_ENVELOPE)!)[0]!.actual).toBe("");
  });

  test("a finish at or better than the expectation is flagged as beaten", () => {
    const scored = {
      ...PRO_ENVELOPE,
      race: { ...PRO_ENVELOPE.race, hasResults: true },
      rows: [
        row("Beat It", { driverId: 1, expFinish: 8.44, actualFinish: 3 }),
        row("Missed It", { driverId: 2, expFinish: 8.44, actualFinish: 20 }),
        row("No Result", { driverId: 3, actualFinish: null }),
      ],
    };
    const rows = displayRows(parsePredictions(scored)!);
    expect(rows[0]).toMatchObject({ actual: "P3", beat: true });
    expect(rows[1]).toMatchObject({ actual: "P20", beat: false });
    expect(rows[2]).toMatchObject({ actual: "", beat: false });
  });
});

describe("expectationLine", () => {
  test("names the grid slot and the fantasy-shaped expectations", () => {
    const parsed = parsePredictions(PRO_ENVELOPE)!;
    expect(expectationLine(parsed.rows[0]!)).toBe("starts 4 · 32 laps led · 12 fast laps");
  });

  test("a Thursday run says there is no grid rather than printing null", () => {
    const parsed = parsePredictions({ ...PRO_ENVELOPE, rows: [row("Ace", { driverId: 1, startPos: null })] })!;
    expect(expectationLine(parsed.rows[0]!)).toContain("no grid yet");
  });
});

// CSV encoding, streaming, and the dataset registry (WS-G). The encoding tests
// pin the Excel-compat choices (BOM, CRLF, quoting, formula guarding); the
// registry tests assert every dataset's rows line up with its declared columns,
// which is what keeps "export on every table" from silently drifting.
import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  CSV_BOM,
  csvCell,
  csvDocument,
  csvFilename,
  csvLine,
  csvResponse,
} from "../src/app/csv.ts";
import { DATASETS, datasetFor, parseDatasetParams } from "../src/app/datasets.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop } from "./seed.ts";

describe("csv encoding", () => {
  test("plain values pass through unquoted", () => {
    expect(csvCell("Chase Elliott")).toBe("Chase Elliott");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(4.5)).toBe("4.5");
    // SQL hands back binary-float quotients; Excel should not show the noise.
    expect(csvCell(11.25925925925926)).toBe("11.259259");
    expect(csvCell(100.50111111111116)).toBe("100.501111");
    expect(csvCell(0.7979471316085489)).toBe("0.797947");
    // Integers stay integers — no "12.000000".
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(true)).toBe("true");
  });

  test("null and undefined become empty cells, not the strings", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("null")).toBe("null");
  });

  test("non-finite numbers become empty rather than NaN/Infinity text", () => {
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe("");
  });

  test("commas, quotes, newlines and edge whitespace force quoting", () => {
    expect(csvCell("Talladega, AL")).toBe('"Talladega, AL"');
    expect(csvCell('He said "go"')).toBe('"He said ""go"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  test("cells Excel would evaluate as formulas are neutralized", () => {
    // Without the apostrophe this executes on open — a CSV export of
    // user-influenced text is the classic injection vector.
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvCell("@import")).toBe("'@import");
    expect(csvCell("-2+3")).toBe("'-2+3");
    // A negative *number* is untouched — only strings are guarded.
    expect(csvCell(-2.5)).toBe("-2.5");
  });

  test("records end with CRLF and documents start with the BOM", () => {
    expect(csvLine(["a", "b"])).toBe("a,b\r\n");
    const doc = csvDocument(["x"], [[1], [2]]);
    expect(doc.startsWith(CSV_BOM)).toBe(true);
    expect(doc).toBe(`${CSV_BOM}x\r\n1\r\n2\r\n`);
  });

  test("filenames drop empty parts and sanitize the rest", () => {
    expect(csvFilename(["looplab", "cup", "standings", 2025])).toBe("looplab-cup-standings-2025.csv");
    expect(csvFilename(["looplab", null, "race", "Coca-Cola 600"])).toBe("looplab-race-coca-cola-600.csv");
    expect(csvFilename(["looplab", "", undefined, "a/b\\c"])).toBe("looplab-a-b-c.csv");
    expect(csvFilename([])).toBe("export.csv");
  });
});

describe("csv streaming response", () => {
  /**
   * Decode WITHOUT dropping the BOM — `Response.text()` strips a leading BOM
   * per spec, which would hide the very byte Excel needs to see.
   */
  async function read(res: Response): Promise<string> {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  }

  test("streams header + every row with the download headers", async () => {
    const res = csvResponse({
      filename: "looplab-test.csv",
      columns: ["driver", "finish"],
      rows: [["Alpha", 1], ["Beta, Jr.", 2]],
    });
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="looplab-test.csv"');
    expect(await read(res)).toBe(`${CSV_BOM}driver,finish\r\nAlpha,1\r\n"Beta, Jr.",2\r\n`);
  });

  test("the body really starts with the UTF-8 BOM bytes Excel looks for", async () => {
    const res = csvResponse({ filename: "bom.csv", columns: ["driver"], rows: [["Sébastien Bourdais"]] });
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  test("an empty dataset still sends the header row", async () => {
    const res = csvResponse({ filename: "empty.csv", columns: ["a", "b"], rows: [] });
    expect(await read(res)).toBe(`${CSV_BOM}a,b\r\n`);
  });

  test("rows are pulled lazily, in chunks — not materialized up front", async () => {
    let produced = 0;
    function* rows(): Generator<unknown[]> {
      for (let i = 0; i < 1200; i++) {
        produced++;
        yield [i];
      }
    }
    const res = csvResponse({ filename: "big.csv", columns: ["i"], rows: rows(), chunkRows: 500 });
    const reader = res.body!.getReader();
    await reader.read(); // header + first chunk only
    expect(produced).toBe(500);
    expect(produced).toBeLessThan(1200);
    await reader.cancel();
  });

  test("cancelling the download stops row production", async () => {
    let produced = 0;
    function* rows(): Generator<unknown[]> {
      for (let i = 0; i < 5000; i++) {
        produced++;
        yield [i];
      }
    }
    const res = csvResponse({ filename: "big.csv", columns: ["i"], rows: rows(), chunkRows: 100 });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    const afterCancel = produced;
    await new Promise((r) => setTimeout(r, 5));
    expect(produced).toBe(afterCancel);
    expect(produced).toBeLessThan(5000);
  });
});

// --- dataset registry over a seeded database ---

function seedWorld(): Database {
  const db = testDb();
  seedDriver(db, 10, "Alpha Driver");
  seedDriver(db, 11, "Beta Driver");
  for (const [i, season] of [2023, 2024].entries()) {
    const raceId = 500 + i;
    seedRace(db, { raceId, season, raceName: `Test ${season}`, raceDateUtc: `${season}-05-01T18:00:00` });
    seedResult(db, { raceId, driverId: 10, finish: 1, start: 2, lapsLed: 50, points: 45 });
    seedResult(db, { raceId, driverId: 11, finish: 2, start: 1, lapsLed: 10, points: 40 });
    seedLoop(db, { raceId, driverId: 10, avgPs: 3, passesGf: 40, passedGf: 20, fastLaps: 30, top15Laps: 90, rating: 110 });
    seedLoop(db, { raceId, driverId: 11, avgPs: 5, passesGf: 30, passedGf: 25, fastLaps: 10, top15Laps: 80, rating: 95 });
  }
  const p = { db };
  analyticsService.computeAll(p);
  return db;
}

function paramsFor(query: string, seriesId = 1) {
  return parseDatasetParams(new URL(`http://x/export/x.csv${query}`), seriesId);
}

describe("dataset registry", () => {
  const db = seedWorld();
  const p = { db };

  test("every dataset emits rows exactly as wide as its declared columns", () => {
    // The header is a public contract; a row that drifts from it silently
    // mislabels every column to the right of the drift.
    const params = paramsFor("?season=2024&race=500&driver=10&drivers=10,11&type=intermediate&from=2023&to=2024");
    let checked = 0;
    for (const dataset of Object.values(DATASETS)) {
      const built = dataset.build(p, params);
      if (!built) continue;
      checked++;
      for (const row of built.rows) expect(row.length).toBe(dataset.columns.length);
      expect(built.filename.endsWith(".csv")).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(9);
  });

  test("standings export carries the season and ranks from 1", () => {
    const built = datasetFor("standings")!.build(p, paramsFor("?season=2024"))!;
    expect(built.filename).toBe("looplab-cup-standings-2024.csv");
    expect(built.rows[0]![0]).toBe(1);
    expect(built.rows[0]![2]).toBe("Alpha Driver");
    expect(built.rows.length).toBe(2);
  });

  test("season-stats honors the from/to range filter", () => {
    const all = datasetFor("season-stats")!.build(p, paramsFor(""))!;
    const oneSeason = datasetFor("season-stats")!.build(p, paramsFor("?from=2024&to=2024"))!;
    expect(all.rows.length).toBe(4);
    expect(oneSeason.rows.length).toBe(2);
    expect(oneSeason.rows.every((r) => r[2] === 2024)).toBe(true);
    expect(oneSeason.filename).toBe("looplab-cup-season-stats-2024-2024.csv");
  });

  test("race results name the file after the race, not the id", () => {
    const built = datasetFor("race-results")!.build(p, paramsFor("?race=500"))!;
    expect(built.filename).toBe("looplab-race-2023-test-2023.csv");
    expect(built.rows.length).toBe(2);
    expect(built.rows[0]![3]).toBe(1); // finish
  });

  test("compare spans the requested series and only the requested drivers", () => {
    const built = datasetFor("compare")!.build(p, paramsFor("?drivers=10&series=1"))!;
    expect(built.rows.length).toBe(2); // one driver × two seasons
    expect(built.rows.every((r) => r[1] === 10)).toBe(true);
    expect(built.rows[0]![0]).toBe(1); // series_id column
  });

  test("subject-less or unknown requests refuse rather than exporting everything", () => {
    expect(datasetFor("race-results")!.build(p, paramsFor(""))).toBeNull();
    expect(datasetFor("driver-log")!.build(p, paramsFor(""))).toBeNull();
    expect(datasetFor("compare")!.build(p, paramsFor(""))).toBeNull();
    expect(datasetFor("race-results")!.build(p, paramsFor("?race=999999"))).toBeNull();
    expect(datasetFor("driver-log")!.build(p, paramsFor("?driver=999999"))).toBeNull();
    expect(datasetFor("nope")).toBeNull();
  });

  test("malformed query values fall back instead of throwing", () => {
    const params = paramsFor("?season=abc&race=&drivers=x,11,&min=zzz");
    expect(params.season).toBeNull();
    expect(params.raceId).toBeNull();
    expect(params.driverIds).toEqual([11]);
    expect(params.minStarts).toBe(1);
    expect(params.platform).toBe("dk");
  });
});

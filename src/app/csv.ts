// CSV encoding + streamed download responses (WS-G). Pure string work plus one
// Response builder: the dataset registry (datasets.ts) supplies rows, this file
// decides how they look on the wire and how they reach the client.
//
// Excel compatibility is the acceptance bar, so three choices are deliberate:
//   * a UTF-8 BOM, without which Excel decodes the file as the local ANSI
//     codepage and mangles every accented driver name;
//   * CRLF line endings (RFC 4180, and what Excel writes itself);
//   * formula-injection guarding — a cell that Excel would evaluate as a
//     formula is prefixed with an apostrophe, so a hostile-looking value is
//     shown as text instead of executed on open.

export const CSV_BOM = "\uFEFF";
export const CSV_EOL = "\r\n";

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Decimal places kept for non-integer numbers.
 *
 * Averages arrive straight from SQL as binary-float quotients, so an avg finish
 * of 11.3 serializes as `11.25925925925926` — fifteen digits of arithmetic
 * noise in a file people open in Excel. Six places is well past anything the
 * inputs support (finishes and lap counts are integers) while leaving far more
 * precision than the site's one-decimal display, so nobody analyzing the export
 * loses real signal. Integers are written untouched, never `1.000000`.
 */
export const CSV_DECIMALS = 6;

/** One cell: numbers plain, null/undefined empty, strings quoted when needed. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (Number.isInteger(value)) return String(value);
    // Round, then re-parse so trailing zeros drop: 0.5 stays "0.5".
    return String(Number(value.toFixed(CSV_DECIMALS)));
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (NEEDS_QUOTES.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** One CRLF-terminated record. */
export function csvLine(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",") + CSV_EOL;
}

/** Whole document as a string — used by tests and small exports. */
export function csvDocument(columns: readonly string[], rows: Iterable<readonly unknown[]>): string {
  let out = CSV_BOM + csvLine(columns);
  for (const row of rows) out += csvLine(row);
  return out;
}

const FILENAME_UNSAFE = /[^A-Za-z0-9._-]+/g;

/**
 * Build a download filename from parts: `looplab-cup-standings-2025.csv`.
 * Empty/nullish parts drop out so callers can pass optional filters inline.
 */
export function csvFilename(parts: Array<string | number | null | undefined>): string {
  const stem = parts
    .filter((p) => p !== null && p !== undefined && String(p) !== "")
    .map((p) => String(p).trim().toLowerCase().replace(FILENAME_UNSAFE, "-"))
    .filter((p) => p !== "" && p !== "-")
    .join("-");
  return `${stem || "export"}.csv`;
}

/** Rows per stream chunk — big enough to amortize enqueue cost, small enough
 *  that the first bytes leave immediately on a huge table. */
export const CSV_CHUNK_ROWS = 500;

/**
 * Stream a CSV download. Rows are pulled from the iterator as the client reads
 * them, so a large export starts arriving before it is fully built and never
 * exists in memory as one string.
 */
export function csvResponse(opts: {
  filename: string;
  columns: readonly string[];
  rows: Iterable<readonly unknown[]>;
  chunkRows?: number;
}): Response {
  const chunkRows = opts.chunkRows ?? CSV_CHUNK_ROWS;
  const iterator = opts.rows[Symbol.iterator]();
  const encoder = new TextEncoder();
  let sentHeader = false;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      let buffer = "";
      if (!sentHeader) {
        buffer = CSV_BOM + csvLine(opts.columns);
        sentHeader = true;
      }
      for (let i = 0; i < chunkRows; i++) {
        const next = iterator.next();
        if (next.done) {
          if (buffer) controller.enqueue(encoder.encode(buffer));
          controller.close();
          return;
        }
        buffer += csvLine(next.value);
      }
      controller.enqueue(encoder.encode(buffer));
    },
    cancel() {
      iterator.return?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${opts.filename}"`,
    },
  });
}

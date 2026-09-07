// The /export/{dataset}.csv route (WS-G). Kept beside auth.ts and webhooks.ts
// rather than inside server.ts so the router stays a router: this file owns
// the gate, the parameter parsing, and the not-found answers, and hands the
// registry's rows to the streaming encoder.
import type { Providers } from "../providers/index.ts";
import { featureEnabled } from "./gate.ts";
import { PRO_REQUIRED_BODY } from "./gate.ts";
import type { Viewer } from "./viewer.ts";
import { csvResponse } from "./csv.ts";
import { DATASETS, datasetFor, parseDatasetParams } from "./datasets.ts";

type P = Pick<Providers, "db">;

const EXPORT_PATH = /^\/export\/([a-z-]+)\.csv$/;

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Handles CSV downloads; returns null for every other path so the server falls
 * through to its page router. Export is Pro across the board (spec §4), so the
 * entitlement check happens before any data is read.
 */
export function handleDownloadRequest(
  p: P,
  url: URL,
  viewer: Viewer,
  validSeries: ReadonlySet<number>,
  defaultSeries: number,
): Response | null {
  const match = EXPORT_PATH.exec(url.pathname);
  if (!match) return null;
  if (!featureEnabled("export", viewer)) return json(PRO_REQUIRED_BODY, 403);

  const dataset = datasetFor(match[1]!);
  if (!dataset) return json({ error: "unknown_dataset", datasets: Object.keys(DATASETS) }, 404);

  // Series comes from the query: these routes are un-prefixed because a
  // download has no page context to inherit one from.
  const requested = Number.parseInt(url.searchParams.get("series") ?? "", 10);
  const seriesId = validSeries.has(requested) ? requested : defaultSeries;
  const built = dataset.build(p, parseDatasetParams(url, seriesId));
  if (!built) return json({ error: "not_found", dataset: dataset.id }, 404);

  return csvResponse({ filename: built.filename, columns: dataset.columns, rows: built.rows });
}

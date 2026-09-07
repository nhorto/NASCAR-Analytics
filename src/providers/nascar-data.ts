// nascaR.data fallback source (launch plan WS-C): the CRAN package's weekly
// Parquet release, sourced from DriverAverages.com with permission. Results
// only, 1949+, no loop data — the fallback for official results if the CDN's
// weekend-feed goes missing (like the 2025 YellaWood 500 did).
//
// Verified 2026-09-07: the release is Parquet-ONLY (the README's CSV URLs
// 404). Files update Mondays 05:00 ET during the season.
import { parquetReadObjects } from "hyparquet";
import type { NascarDataRow } from "../domains/data-health/types.ts";

export const NASCAR_DATA_BASE = "https://nascar.kylegrealis.com";

const FILE_BY_SERIES: Record<number, string> = {
  1: "cup_series.parquet",
  2: "nxs_series.parquet", // the package's sponsor-neutral name for Xfinity
  3: "truck_series.parquet",
};

export function nascarDataUrl(seriesId: number): string {
  const file = FILE_BY_SERIES[seriesId];
  if (!file) throw new Error(`nascaR.data has no release for series ${seriesId}`);
  return `${NASCAR_DATA_BASE}/${file}`;
}

/** hyparquet yields BigInt for integer columns; coerce everything to plain JS. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Parse a release file into rows. Rows without the join keys (season, race
 * ordinal, finish, driver) are dropped — they cannot be attached to anything. */
export async function parseSeriesParquet(file: ArrayBuffer): Promise<NascarDataRow[]> {
  const records = await parquetReadObjects({ file });
  const rows: NascarDataRow[] = [];
  for (const r of records as Array<Record<string, unknown>>) {
    const season = num(r.Season);
    const race = num(r.Race);
    const finish = num(r.Finish);
    const driver = str(r.Driver);
    const track = str(r.Track);
    if (season === null || race === null || finish === null || driver === null || track === null)
      continue;
    rows.push({
      season,
      race,
      track,
      raceName: str(r.Name) ?? "",
      finish,
      start: num(r.Start),
      car: str(r.Car),
      driver,
      team: str(r.Team),
      make: str(r.Make),
      points: num(r.Pts),
      laps: num(r.Laps),
      led: num(r.Led),
      status: str(r.Status),
    });
  }
  return rows;
}

/** Download and parse one series' release. */
export async function fetchSeriesRelease(
  seriesId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<NascarDataRow[]> {
  const url = nascarDataUrl(seriesId);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`nascaR.data release fetch failed: HTTP ${res.status} for ${url}`);
  return parseSeriesParquet(await res.arrayBuffer());
}

import type { Providers } from "../../providers/index.ts";
import type {
  DriverSummary,
  DriverRaceLogEntry,
  IdentityIssue,
  CareerSeasonRow,
  CareerSeriesSummary,
  DriverCareer,
} from "./types.ts";
import { DEFAULT_SERIES_ID } from "./config.ts";
import * as repo from "./repo.ts";

type Db = Pick<Providers, "db">;

export function driverIndex(p: Db, seriesId = DEFAULT_SERIES_ID): DriverSummary[] {
  return repo.listDriverSummaries(p.db, seriesId);
}

/** Look a driver up by id, exact name, or partial name (case-insensitive). */
export function findDriver(
  p: Db,
  query: number | string,
  seriesId = DEFAULT_SERIES_ID,
): DriverSummary | null {
  const driverId =
    typeof query === "number" ? query : repo.findDriverIdByName(p.db, query);
  if (driverId === null) return null;
  return driverIndex(p, seriesId).find((d) => d.driverId === driverId) ?? null;
}

export function driverRaceLog(
  p: Db,
  driverId: number,
  seriesId = DEFAULT_SERIES_ID,
): DriverRaceLogEntry[] {
  return repo.raceLogForDriver(p.db, driverId, seriesId);
}

/** Verifies the working assumption that CDN driver_ids are stable: one name, one id. */
export function identityIssues(p: Db): IdentityIssue[] {
  return repo.duplicateNames(p.db);
}

// ---- Cross-series career ----

/**
 * Fold per (series, season) rows into one summary per series, ordered by series
 * id. Avg finish is races-weighted across the driver's seasons in that series.
 */
export function summariseSeries(seasons: CareerSeasonRow[]): CareerSeriesSummary[] {
  const bySeries = new Map<number, CareerSeasonRow[]>();
  for (const row of seasons) {
    const list = bySeries.get(row.seriesId);
    if (list) list.push(row);
    else bySeries.set(row.seriesId, [row]);
  }
  const out: CareerSeriesSummary[] = [];
  for (const [seriesId, rows] of bySeries) {
    const races = rows.reduce((a, r) => a + r.races, 0);
    const finishWeight = rows.reduce(
      (a, r) => a + (r.avgFinish === null ? 0 : r.avgFinish * r.races),
      0,
    );
    out.push({
      seriesId,
      firstSeason: Math.min(...rows.map((r) => r.season)),
      lastSeason: Math.max(...rows.map((r) => r.season)),
      seasons: new Set(rows.map((r) => r.season)).size,
      races,
      wins: rows.reduce((a, r) => a + r.wins, 0),
      top5s: rows.reduce((a, r) => a + r.top5s, 0),
      top10s: rows.reduce((a, r) => a + r.top10s, 0),
      avgFinish: races > 0 ? finishWeight / races : null,
    });
  }
  return out.sort((a, b) => a.seriesId - b.seriesId);
}

/** A driver's full record across all national series; null if no points races. */
export function driverCareer(p: Db, driverId: number): DriverCareer | null {
  const seasons = repo.careerSeasonRows(p.db, driverId);
  if (seasons.length === 0) return null;
  const identity = repo.careerIdentity(p.db, driverId);
  if (!identity) return null;
  return {
    driverId,
    ...identity,
    firstSeason: Math.min(...seasons.map((s) => s.season)),
    lastSeason: Math.max(...seasons.map((s) => s.season)),
    series: summariseSeries(seasons),
    seasons,
  };
}

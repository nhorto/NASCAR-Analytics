import type { Providers } from "../../providers/index.ts";
import type { DriverSummary, DriverRaceLogEntry, IdentityIssue } from "./types.ts";
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

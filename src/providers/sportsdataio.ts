// ⚠ NOT FOR PRODUCTION — SportsDataIO adapter STUB (launch plan WS-C).
//
// SportsDataIO carries NASCAR (results + basic driver stats, next-day) in its
// paid catalogue; the hobby "Discovery Lab" tier is roughly $99–149/mo. This
// stub exists so a CDN lockout becomes "a config change plus a card": the
// types and the normalizer are written against their documented v2 schema, so
// wiring it into a sync path is a follow-up task measured in hours, not days.
//
// It is deliberately NOT imported by any sync path, and `assertUsable` throws
// unless the caller explicitly acknowledges the stub status. Field names
// follow the public API docs (sportsdata.io/developers/api-documentation/nascar);
// verify against a real free-trial payload before ever promoting this —
// that verification needs the owner's trial key and is untested here.
import type { FallbackResultRow } from "../domains/data-health/types.ts";

export const SPORTSDATAIO_BASE = "https://api.sportsdata.io/v2/nascar";

/** Series naming in their API: Cup = "sc" (Sprint/premier Cup), Xfinity = "xf", Trucks = "cw". */
const SDIO_SERIES: Record<number, string> = { 1: "sc", 2: "xf", 3: "cw" };

export function racesUrl(season: number, seriesId: number, apiKey: string): string {
  const s = SDIO_SERIES[seriesId];
  if (!s) throw new Error(`SportsDataIO stub: unknown series ${seriesId}`);
  return `${SPORTSDATAIO_BASE}/races/${s}/${season}?key=${apiKey}`;
}

export function raceResultsUrl(raceId: number, apiKey: string): string {
  return `${SPORTSDATAIO_BASE}/raceresult/${raceId}?key=${apiKey}`;
}

/** Their race identity — note: SportsDataIO RaceID is NOT the NASCAR CDN race_id. */
export interface SdioRace {
  RaceID: number;
  SeasonType: number;
  Season: number;
  Name: string;
  Track: string;
  Date: string | null;
  DateTime: string | null;
}

export interface SdioDriverResult {
  DriverID: number; // their id space, not the CDN's
  Driver: string;
  Manufacturer: string | null;
  Number: string | null;
  StartPosition: number | null;
  Position: number | null;
  Laps: number | null;
  LapsLed: number | null;
  Points: number | null;
  Status: string | null;
}

export interface SdioRaceResult {
  Race: SdioRace;
  DriverRaces: SdioDriverResult[];
}

/**
 * Map one SportsDataIO race result onto our fallback row shape. The caller
 * must supply OUR raceId (matched by date/track — their RaceID is foreign) and
 * a driver-name resolver (their DriverID is foreign too; names are the join,
 * exactly like the nascaR.data adapter).
 */
export function normalizeSdioResults(
  ourRaceId: number,
  payload: SdioRaceResult,
  resolveDriverId: (fullName: string) => number | undefined,
): { rows: FallbackResultRow[]; unmatchedDrivers: string[] } {
  const rows: FallbackResultRow[] = [];
  const unmatched: string[] = [];
  for (const d of payload.DriverRaces) {
    if (d.Position === null) continue; // no finishing position -> not a classified result
    const driverId = resolveDriverId(d.Driver);
    if (driverId === undefined) {
      unmatched.push(d.Driver);
      continue;
    }
    rows.push({
      raceId: ourRaceId,
      driverId,
      finishingPosition: d.Position,
      startingPosition: d.StartPosition,
      carNumber: d.Number,
      teamName: null, // not in their basic result schema
      lapsLed: d.LapsLed,
      carMake: d.Manufacturer,
      pointsEarned: d.Points,
      lapsCompleted: d.Laps,
      finishingStatus: d.Status,
    });
  }
  return { rows, unmatchedDrivers: unmatched };
}

/** Guard: forces call sites to acknowledge this adapter is an unverified stub. */
export function assertUsable(acknowledgeStub: boolean): void {
  if (!acknowledgeStub) {
    throw new Error(
      "SportsDataIO adapter is a NOT-FOR-PRODUCTION stub — schema unverified against a real payload. " +
        "See src/providers/sportsdataio.ts before wiring it into any sync path.",
    );
  }
}

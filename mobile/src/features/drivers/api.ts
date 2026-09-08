// Driver list + profile data from the server's JSON API. Free tier is Cup
// (series 1) — the server 403s other series for non-Pro viewers, and this
// app does not ask for them yet. Shapes re-declare the server's
// DriverSummary / DriverRaceLogEntry / DriverSeasonStats slices.
import { timedFetch } from "../../lib/http.ts";

export interface DriverSummary {
  driverId: number;
  fullName: string;
  firstSeason: number;
  lastSeason: number;
  races: number;
  wins: number;
  latestTeam: string | null;
  latestCarNumber: string | null;
  latestCarMake: string | null;
}

export interface RaceLogEntry {
  raceId: number;
  season: number;
  raceName: string;
  start: number | null;
  finish: number;
  lapsLed: number;
  rating: number | null;
}

export interface SeasonStatsRow {
  season: number;
  races: number;
  wins: number;
  top5s: number;
  top10s: number;
  avgStart: number | null;
  avgFinish: number | null;
  lapsLed: number;
  points: number;
  avgRating: number | null;
  adjPassEfficiency: number | null;
  closerScore: number | null;
  /**
   * Races that actually had loop data. Aggregating a season *range* must
   * weight the loop metrics by this and not by `races`, or a pre-2019 season
   * with no loop data drags the average toward zero (the same trap
   * src/app/client/compare.js documents).
   */
  loopRaces: number;
  top15LapPct: number | null;
}

export interface DriverProfile {
  driver: DriverSummary;
  raceLog: RaceLogEntry[];
  seasons: SeasonStatsRow[];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export function parseDriverSummary(value: unknown): DriverSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.driverId !== "number" || typeof v.fullName !== "string") return null;
  return {
    driverId: v.driverId,
    fullName: v.fullName,
    firstSeason: num(v.firstSeason),
    lastSeason: num(v.lastSeason),
    races: num(v.races),
    wins: num(v.wins),
    latestTeam: strOrNull(v.latestTeam),
    latestCarNumber: strOrNull(v.latestCarNumber),
    latestCarMake: strOrNull(v.latestCarMake),
  };
}

export function parseDrivers(value: unknown): DriverSummary[] {
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>).drivers;
  if (!Array.isArray(list)) return [];
  return list.map(parseDriverSummary).filter((d): d is DriverSummary => d !== null);
}

function parseRaceLog(value: unknown): RaceLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.raceId !== "number" || typeof r.raceName !== "string") return [];
    return [
      {
        raceId: r.raceId,
        season: num(r.season),
        raceName: r.raceName,
        start: numOrNull(r.start),
        finish: num(r.finish),
        lapsLed: num(r.lapsLed),
        rating: numOrNull(r.rating),
      },
    ];
  });
}

export function parseSeasons(value: unknown): SeasonStatsRow[] {
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>).seasons;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.season !== "number") return [];
    return [
      {
        season: r.season,
        races: num(r.races),
        wins: num(r.wins),
        top5s: num(r.top5s),
        top10s: num(r.top10s),
        avgStart: numOrNull(r.avgStart),
        avgFinish: numOrNull(r.avgFinish),
        lapsLed: num(r.lapsLed),
        points: num(r.points),
        avgRating: numOrNull(r.avgRating),
        adjPassEfficiency: numOrNull(r.adjPassEfficiency),
        closerScore: numOrNull(r.closerScore),
        loopRaces: num(r.loopRaces),
        top15LapPct: numOrNull(r.top15LapPct),
      },
    ];
  });
}

export async function fetchDrivers(
  base: string,
  query: string,
  seriesId = 1,
): Promise<DriverSummary[] | null> {
  try {
    const q = query.trim() === "" ? "" : `&q=${encodeURIComponent(query.trim())}`;
    const res = await timedFetch(`${base}/api/drivers?series=${seriesId}${q}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return parseDrivers(await res.json());
  } catch {
    return null;
  }
}

/**
 * One driver's per-season stats for a series. Non-Cup series are Pro-gated
 * server-side, so a free viewer's request for series 2/3 comes back 403 and
 * this returns null — which the compare screen renders as its locked state.
 */
export async function fetchDriverSeasons(
  base: string,
  driverId: number,
  seriesId: number,
): Promise<SeasonStatsRow[] | null> {
  try {
    const res = await timedFetch(`${base}/api/drivers/${driverId}/stats?series=${seriesId}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return parseSeasons(await res.json());
  } catch {
    return null;
  }
}

export async function fetchDriverProfile(base: string, driverId: number): Promise<DriverProfile | null> {
  try {
    const [driverRes, statsRes] = await Promise.all([
      timedFetch(`${base}/api/drivers/${driverId}?series=1`),
      timedFetch(`${base}/api/drivers/${driverId}/stats?series=1`),
    ]);
    if (!driverRes.ok) return null;
    const driverBody = (await driverRes.json()) as Record<string, unknown>;
    const driver = parseDriverSummary(driverBody.driver);
    if (!driver) return null;
    // Stats can 404 for a driver with no computed seasons; the profile still renders.
    const seasons = statsRes.ok ? parseSeasons(await statsRes.json()) : [];
    return { driver, raceLog: parseRaceLog(driverBody.raceLog), seasons };
  } catch {
    return null;
  }
}

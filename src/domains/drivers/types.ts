import type { TrackType } from "../data-ingestion/types.ts";

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

export interface DriverRaceLogEntry {
  raceId: number;
  season: number;
  raceDateUtc: string | null;
  raceName: string;
  trackType: TrackType;
  start: number | null;
  finish: number;
  status: string | null;
  lapsLed: number;
  points: number;
  rating: number | null;
  disqualified: boolean;
}

/** A driver-identity anomaly: the same name attached to more than one driver_id. */
export interface IdentityIssue {
  fullName: string;
  driverIds: number[];
}

/** One (series, season) slice of a driver's career (points races). */
export interface CareerSeasonRow {
  seriesId: number;
  season: number;
  races: number;
  wins: number;
  top5s: number;
  top10s: number;
  avgFinish: number | null;
}

/** A driver's totals within one series, across every season they ran it. */
export interface CareerSeriesSummary {
  seriesId: number;
  firstSeason: number;
  lastSeason: number;
  seasons: number;
  races: number;
  wins: number;
  top5s: number;
  top10s: number;
  avgFinish: number | null;
}

/** A driver's identity + full record across all national series. */
export interface DriverCareer {
  driverId: number;
  fullName: string;
  latestTeam: string | null;
  latestCarNumber: string | null;
  latestCarMake: string | null;
  firstSeason: number;
  lastSeason: number;
  /** Per-series totals, ordered by series id (Cup, Xfinity, Trucks). */
  series: CareerSeriesSummary[];
  /** Per (series, season) rows, newest season first. */
  seasons: CareerSeasonRow[];
}

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

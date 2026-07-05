import type { TrackType } from "../data-ingestion/types.ts";

// Source rows: joined views over ingestion-owned tables, points races only.

/** One official result in a points race. */
export interface PointsResultRow {
  raceId: number;
  seriesId: number;
  season: number;
  trackType: TrackType;
  raceDateUtc: string | null;
  driverId: number;
  start: number | null;
  finish: number;
  status: string | null;
  lapsLed: number;
  points: number;
  playoffPoints: number;
}

/** One driver's loop stats in a points race. */
export interface PointsLoopRow {
  raceId: number;
  seriesId: number;
  season: number;
  trackType: TrackType;
  driverId: number;
  avgPs: number;
  closingPs: number;
  closingLapsDiff: number;
  passesGf: number;
  passedGf: number;
  fastLaps: number;
  top15Laps: number;
  laps: number;
  rating: number;
}

/**
 * League-average baselines per position bucket (bucket 0 = P1–P5, 1 = P6–P10, …).
 * Proprietary metrics are residuals against these: what did this driver do
 * relative to the average car running in the same part of the field?
 */
export interface LeagueExpectations {
  /** Mean green-flag pass efficiency by avg running-position bucket. */
  passEfficiencyByAvgPs: Map<number, number>;
  /** Mean closing-laps position change by closing-position bucket. */
  closingGainByClosingPs: Map<number, number>;
}

// Computed rows: what the compute run persists.

export interface DriverSeasonStats {
  driverId: number;
  seriesId: number;
  season: number;
  races: number;
  wins: number;
  top5s: number;
  top10s: number;
  dnfs: number;
  avgStart: number | null;
  avgFinish: number | null;
  lapsLed: number;
  points: number;
  playoffPoints: number;
  loopRaces: number;
  avgRating: number | null;
  top15LapPct: number | null;
  fastLapPct: number | null;
  passEfficiency: number | null;
  adjPassEfficiency: number | null;
  avgClosingGain: number | null;
  closerScore: number | null;
}

export interface DriverTrackTypeStats {
  driverId: number;
  seriesId: number;
  season: number;
  trackType: TrackType;
  races: number;
  wins: number;
  top5s: number;
  top10s: number;
  dnfs: number;
  avgStart: number | null;
  avgFinish: number | null;
  lapsLed: number;
  loopRaces: number;
  avgRating: number | null;
  passEfficiency: number | null;
  adjPassEfficiency: number | null;
  avgClosingGain: number | null;
  closerScore: number | null;
}

/** Trailing-window form as of one race (inclusive), for trend lines. */
export interface DriverFormRow {
  driverId: number;
  seriesId: number;
  raceId: number;
  season: number;
  raceDateUtc: string | null;
  windowRaces: number;
  avgFinish: number;
  avgStart: number | null;
  avgRating: number | null;
  avgClosingGain: number | null;
}

/** Season stats joined with the driver's name, for standings pages. */
export interface SeasonStanding extends DriverSeasonStats {
  fullName: string;
}

/** Multi-season aggregate for one driver at one track type. */
export interface TrackTypeLeaderRow {
  driverId: number;
  fullName: string;
  starts: number;
  wins: number;
  top5s: number;
  avgFinish: number | null;
  avgRating: number | null;
  adjPassEfficiency: number | null;
  closerScore: number | null;
}

/** The two proprietary season metrics a driver can be ranked on. */
export type MetricKey = "adjPassEfficiency" | "closerScore";

/** One driver's standing on a single proprietary metric within a season. */
export interface MetricRank {
  driverId: number;
  fullName: string;
  loopRaces: number;
  value: number;
  /** 1 = best in the qualified field. */
  rank: number;
  /** How many drivers are ranked on this metric (the "N" in "2nd of N"). */
  field: number;
  /** 0–100, higher = better: share of the qualified field this driver beats. */
  percentile: number;
}

/** Both proprietary-metric leaderboards for one season, best first. */
export interface SeasonMetricBoard {
  seriesId: number;
  season: number;
  /** Number of loop-data regulars who qualified for the boards. */
  qualified: number;
  adjPass: MetricRank[];
  closer: MetricRank[];
}

/** A driver's trailing-window form as of the most recent race. */
export interface FormLeader {
  driverId: number;
  fullName: string;
  raceId: number;
  windowRaces: number;
  avgFinish: number;
  avgRating: number | null;
}

export interface ComputeSummary {
  resultRows: number;
  loopRows: number;
  seasonStatsRows: number;
  trackTypeStatsRows: number;
  formRows: number;
}

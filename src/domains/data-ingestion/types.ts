// Source shapes: fields we consume from the NASCAR CDN feeds.
// Feeds carry more fields than these; raw JSON is archived verbatim, so
// narrowing here loses nothing.

export interface CdnScheduleEvent {
  race_id: number;
  series_id: number;
  track_id: number;
  track_name: string;
  race_name: string;
  event_name: string;
  run_type: number; // 1=practice, 2=qualifying, 3=race
  start_time: string;
  start_time_utc: string | null; // null in 2016-2018 feeds
}

export interface CdnWeekendFeed {
  weekend_race: CdnWeekendRace[];
  weekend_runs: unknown[];
}

export interface CdnWeekendRace {
  race_id: number;
  series_id: number;
  race_season: number;
  race_name: string;
  race_type_id: number;
  restrictor_plate: boolean;
  track_id: number;
  track_name: string;
  race_date: string;
  scheduled_laps: number;
  actual_laps: number;
  stage_1_laps: number;
  stage_2_laps: number;
  stage_3_laps: number;
  stage_4_laps: number;
  number_of_cars_in_field: number;
  pole_winner_driver_id: number;
  number_of_lead_changes: number;
  number_of_leaders: number;
  number_of_cautions: number;
  number_of_caution_laps: number;
  average_speed: number;
  total_race_time: string;
  margin_of_victory: string;
  results: CdnRaceResult[];
  caution_segments: CdnCautionSegment[];
  race_leaders: CdnRaceLeader[];
}

export interface CdnRaceResult {
  finishing_position: number;
  starting_position: number;
  car_number: string;
  driver_fullname: string;
  driver_id: number;
  team_id: number;
  team_name: string;
  qualifying_position: number;
  qualifying_speed: number;
  laps_led: number;
  times_led: number;
  car_make: string;
  sponsor: string;
  points_earned: number;
  playoff_points_earned: number;
  laps_completed: number;
  finishing_status: string;
  points_position: number;
  disqualified: boolean;
}

export interface CdnCautionSegment {
  race_id: number;
  start_lap: number;
  end_lap: number;
  reason: string;
  comment: string;
  flag_state: number;
}

export interface CdnRaceLeader {
  race_id: number;
  start_lap: number;
  end_lap: number;
  car_number: string;
}

export interface CdnLapTimesFeed {
  laps: CdnDriverLaps[];
  flags: CdnFlagSegment[];
}

export interface CdnDriverLaps {
  Number: string;
  FullName: string;
  Manufacturer: string;
  RunningPos: number;
  NASCARDriverID: number;
  Laps: CdnLap[];
}

export interface CdnLap {
  Lap: number;
  LapTime: number | null;
  LapSpeed: string | null;
  RunningPos: number;
}

export interface CdnFlagSegment {
  LapsCompleted: number;
  FlagState: number;
}

export interface CdnLoopStatsRace {
  race_id: number;
  race_name: string;
  series_id: number;
  sch_laps: number;
  act_laps: number;
  drivers: CdnLoopStatsDriver[];
}

export interface CdnLoopStatsDriver {
  driver_id: number;
  start_ps: number;
  mid_ps: number;
  ps: number;
  closing_ps: number;
  closing_laps_diff: number;
  best_ps: number;
  worst_ps: number;
  avg_ps: number;
  passes_gf: number;
  passing_diff: number;
  passed_gf: number;
  quality_passes: number;
  fast_laps: number;
  top15_laps: number;
  lead_laps: number;
  laps: number;
  rating: number;
}

// Normalized rows: what we store.

export type TrackType = "superspeedway" | "intermediate" | "short" | "road" | "dirt" | "unknown";

export interface TrackRow {
  trackId: number;
  name: string;
  defaultTrackType: TrackType;
}

export interface RaceRow {
  raceId: number;
  seriesId: number;
  season: number;
  raceName: string;
  raceTypeId: number;
  trackId: number;
  trackName: string;
  trackType: TrackType;
  raceDate: string;
  raceDateUtc: string | null;
  restrictorPlate: boolean;
  scheduledLaps: number;
  actualLaps: number;
  stage1Laps: number;
  stage2Laps: number;
  stage3Laps: number;
  carsInField: number;
  poleWinnerDriverId: number;
  leadChanges: number;
  leaders: number;
  cautions: number;
  cautionLaps: number;
  averageSpeed: number;
  totalRaceTime: string;
  marginOfVictory: string;
}

export interface DriverRow {
  driverId: number;
  fullName: string;
}

export interface ResultRow {
  raceId: number;
  driverId: number;
  finishingPosition: number;
  startingPosition: number;
  carNumber: string;
  teamId: number;
  teamName: string;
  qualifyingPosition: number;
  qualifyingSpeed: number;
  lapsLed: number;
  timesLed: number;
  carMake: string;
  sponsor: string;
  pointsEarned: number;
  playoffPointsEarned: number;
  lapsCompleted: number;
  finishingStatus: string;
  pointsPosition: number;
  disqualified: boolean;
}

export interface LoopStatRow {
  raceId: number;
  driverId: number;
  startPs: number;
  midPs: number;
  finishPs: number;
  closingPs: number;
  closingLapsDiff: number;
  bestPs: number;
  worstPs: number;
  avgPs: number;
  passesGf: number;
  passingDiff: number;
  passedGf: number;
  qualityPasses: number;
  fastLaps: number;
  top15Laps: number;
  leadLaps: number;
  laps: number;
  rating: number;
}

export interface LapTimeRow {
  raceId: number;
  driverId: number;
  lap: number;
  lapTime: number | null;
  lapSpeed: number | null;
  runningPos: number;
}

export interface CautionRow {
  raceId: number;
  startLap: number;
  endLap: number;
  reason: string;
  comment: string;
  flagState: number;
}

export interface RaceLeaderRow {
  raceId: number;
  startLap: number;
  endLap: number;
  carNumber: string;
}

// A schedule race event (run_type=3) normalized for ingestion planning.
export interface ScheduledRace {
  raceId: number;
  seriesId: number;
  season: number;
  trackId: number;
  trackName: string;
  raceName: string;
  startTimeUtc: string;
}

export interface SeasonCoverage {
  season: number;
  scheduledRaces: number;
  racesWithResults: number;
  racesWithLoopStats: number;
  racesWithLapTimes: number;
}

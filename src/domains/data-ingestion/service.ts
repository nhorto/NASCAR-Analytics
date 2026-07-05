import type { Providers } from "../../providers/index.ts";
import type {
  CdnScheduleEvent,
  CdnWeekendFeed,
  CdnWeekendRace,
  CdnLapTimesFeed,
  CdnLoopStatsRace,
  RaceRow,
  DriverRow,
  ResultRow,
  LoopStatRow,
  LapTimeRow,
  CautionRow,
  RaceLeaderRow,
  ScheduledRace,
  SeasonCoverage,
} from "./types.ts";
import {
  scheduleUrl,
  weekendFeedUrl,
  lapTimesUrl,
  loopStatsUrl,
  trackTypeFor,
  LOOPSTATS_FIRST_SEASON,
  LAPTIMES_FIRST_SEASON,
} from "./config.ts";
import * as repo from "./repo.ts";

const RUN_TYPE_RACE = 3;

// ---------------------------------------------------------------------------
// Pure normalizers (feed shape -> stored rows)
// ---------------------------------------------------------------------------

export function normalizeScheduledRaces(
  events: CdnScheduleEvent[],
  season: number,
): ScheduledRace[] {
  const seen = new Set<number>();
  const races: ScheduledRace[] = [];
  for (const e of events) {
    if (e.run_type !== RUN_TYPE_RACE || seen.has(e.race_id)) continue;
    seen.add(e.race_id);
    races.push({
      raceId: e.race_id,
      seriesId: e.series_id,
      season,
      trackId: e.track_id,
      trackName: e.track_name,
      raceName: e.race_name,
      // 2016-2018 feeds have null start_time_utc; local start_time is close
      // enough for scheduling decisions (raceHasHappened has a 6h buffer).
      startTimeUtc: e.start_time_utc ?? e.start_time,
    });
  }
  return races;
}

export function normalizeRace(race: CdnWeekendRace): RaceRow {
  return {
    raceId: race.race_id,
    seriesId: race.series_id,
    season: race.race_season,
    raceName: race.race_name,
    raceTypeId: race.race_type_id,
    trackId: race.track_id,
    trackName: race.track_name,
    trackType: trackTypeFor(race.track_id, race.race_season),
    raceDate: race.race_date,
    raceDateUtc: null,
    restrictorPlate: race.restrictor_plate,
    scheduledLaps: race.scheduled_laps,
    actualLaps: race.actual_laps,
    stage1Laps: race.stage_1_laps,
    stage2Laps: race.stage_2_laps,
    stage3Laps: race.stage_3_laps,
    carsInField: race.number_of_cars_in_field,
    poleWinnerDriverId: race.pole_winner_driver_id,
    leadChanges: race.number_of_lead_changes,
    leaders: race.number_of_leaders,
    cautions: race.number_of_cautions,
    cautionLaps: race.number_of_caution_laps,
    averageSpeed: race.average_speed,
    totalRaceTime: race.total_race_time,
    marginOfVictory: race.margin_of_victory,
  };
}

export function normalizeDrivers(race: CdnWeekendRace): DriverRow[] {
  return race.results.map((r) => ({ driverId: r.driver_id, fullName: r.driver_fullname }));
}

export function normalizeResults(race: CdnWeekendRace): ResultRow[] {
  return race.results.map((r) => ({
    raceId: race.race_id,
    driverId: r.driver_id,
    finishingPosition: r.finishing_position,
    startingPosition: r.starting_position,
    carNumber: r.car_number,
    teamId: r.team_id,
    teamName: r.team_name,
    qualifyingPosition: r.qualifying_position,
    qualifyingSpeed: r.qualifying_speed,
    lapsLed: r.laps_led,
    timesLed: r.times_led,
    carMake: r.car_make,
    sponsor: r.sponsor,
    pointsEarned: r.points_earned,
    playoffPointsEarned: r.playoff_points_earned,
    lapsCompleted: r.laps_completed,
    finishingStatus: r.finishing_status,
    pointsPosition: r.points_position,
    disqualified: r.disqualified,
  }));
}

export function normalizeCautions(race: CdnWeekendRace): CautionRow[] {
  return (race.caution_segments ?? []).map((c) => ({
    raceId: race.race_id,
    startLap: c.start_lap,
    endLap: c.end_lap,
    reason: c.reason,
    comment: c.comment,
    flagState: c.flag_state,
  }));
}

export function normalizeRaceLeaders(race: CdnWeekendRace): RaceLeaderRow[] {
  return (race.race_leaders ?? []).map((l) => ({
    raceId: race.race_id,
    startLap: l.start_lap,
    endLap: l.end_lap,
    carNumber: l.car_number,
  }));
}

export function normalizeLoopStats(feed: CdnLoopStatsRace[]): LoopStatRow[] {
  const race = feed[0];
  if (!race) return [];
  return race.drivers.map((d) => ({
    raceId: race.race_id,
    driverId: d.driver_id,
    startPs: d.start_ps,
    midPs: d.mid_ps,
    finishPs: d.ps,
    closingPs: d.closing_ps,
    closingLapsDiff: d.closing_laps_diff,
    bestPs: d.best_ps,
    worstPs: d.worst_ps,
    avgPs: d.avg_ps,
    passesGf: d.passes_gf,
    passingDiff: d.passing_diff,
    passedGf: d.passed_gf,
    qualityPasses: d.quality_passes,
    fastLaps: d.fast_laps,
    top15Laps: d.top15_laps,
    leadLaps: d.lead_laps,
    laps: d.laps,
    rating: d.rating,
  }));
}

export function normalizeLapTimes(raceId: number, feed: CdnLapTimesFeed): LapTimeRow[] {
  const rows: LapTimeRow[] = [];
  for (const driver of feed.laps ?? []) {
    for (const lap of driver.Laps ?? []) {
      rows.push({
        raceId,
        driverId: driver.NASCARDriverID,
        lap: lap.Lap,
        lapTime: lap.LapTime,
        lapSpeed: lap.LapSpeed === null ? null : Number.parseFloat(lap.LapSpeed),
        runningPos: lap.RunningPos,
      });
    }
  }
  return rows;
}

/** Loop stats exist on the CDN from 2019 (2016-2017 serve null bodies, 2018 403s). */
export function loopStatsExpected(season: number): boolean {
  return season >= LOOPSTATS_FIRST_SEASON;
}

export function lapTimesExpected(season: number): boolean {
  return season >= LAPTIMES_FIRST_SEASON;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface IngestLogger {
  info(message: string): void;
  warn(message: string): void;
}

async function fetchAndArchive(
  providers: Providers,
  url: string,
  archivePath: string,
): Promise<unknown> {
  const result = await providers.cdn.fetchJson(url);
  if (result.status === 200 && result.body !== null) {
    const saved = providers.archive.save(archivePath, result.body);
    repo.recordRawFetch(providers.db, {
      url,
      localPath: saved.path,
      sha256: saved.sha256,
      httpStatus: result.status,
    });
    return result.json;
  }
  repo.recordRawFetch(providers.db, {
    url,
    localPath: null,
    sha256: null,
    httpStatus: result.status,
  });
  return null;
}

/** Fetch a season's schedule; upsert tracks and race shells. */
export async function ingestSeasonSchedule(
  providers: Providers,
  season: number,
  seriesId: number,
): Promise<ScheduledRace[]> {
  const url = scheduleUrl(season, seriesId);
  const json = await fetchAndArchive(providers, url, `${season}/${seriesId}/schedule-feed.json`);
  if (json === null) return [];

  const races = normalizeScheduledRaces(json as CdnScheduleEvent[], season);
  for (const race of races) {
    repo.upsertTrack(providers.db, {
      trackId: race.trackId,
      name: race.trackName,
      defaultTrackType: trackTypeFor(race.trackId, season),
    });
    repo.upsertScheduledRace(providers.db, race, trackTypeFor(race.trackId, season));
  }
  return races;
}

export interface RaceIngestOutcome {
  raceId: number;
  results: boolean;
  loopStats: boolean;
  lapTimes: boolean;
}

/** Ingest all per-race feeds for one race. Missing feeds (403/404) are
 * recorded and skipped, not errors — the CDN legitimately lacks some data. */
export async function ingestRaceData(
  providers: Providers,
  race: ScheduledRace,
  log: IngestLogger,
): Promise<RaceIngestOutcome> {
  const { season, seriesId, raceId } = race;
  const outcome: RaceIngestOutcome = { raceId, results: false, loopStats: false, lapTimes: false };

  const weekendJson = await fetchAndArchive(
    providers,
    weekendFeedUrl(season, seriesId, raceId),
    `${season}/${seriesId}/${raceId}/weekend-feed.json`,
  );
  if (weekendJson !== null) {
    const weekendRace = (weekendJson as CdnWeekendFeed).weekend_race?.[0];
    if (weekendRace && weekendRace.results.length > 0) {
      repo.updateRaceDetails(providers.db, normalizeRace(weekendRace));
      repo.upsertDrivers(providers.db, normalizeDrivers(weekendRace));
      repo.upsertResults(providers.db, normalizeResults(weekendRace));
      repo.replaceCautions(providers.db, raceId, normalizeCautions(weekendRace));
      repo.replaceRaceLeaders(providers.db, raceId, normalizeRaceLeaders(weekendRace));
      outcome.results = true;
    }
  }

  if (loopStatsExpected(season)) {
    const loopJson = await fetchAndArchive(
      providers,
      loopStatsUrl(season, seriesId, raceId),
      `${season}/${seriesId}/${raceId}/loopstats.json`,
    );
    if (loopJson !== null) {
      const rows = normalizeLoopStats(loopJson as CdnLoopStatsRace[]);
      if (rows.length > 0) {
        repo.upsertLoopStats(providers.db, rows);
        outcome.loopStats = true;
      }
    }
  }

  if (lapTimesExpected(season)) {
    const lapJson = await fetchAndArchive(
      providers,
      lapTimesUrl(season, seriesId, raceId),
      `${season}/${seriesId}/${raceId}/lap-times.json`,
    );
    if (lapJson !== null) {
      const rows = normalizeLapTimes(raceId, lapJson as CdnLapTimesFeed);
      if (rows.length > 0) {
        repo.upsertLapTimes(providers.db, rows);
        outcome.lapTimes = true;
      }
    }
  }

  if (!outcome.results) log.warn(`race ${raceId} (${season}): no results ingested`);
  return outcome;
}

export interface BackfillOptions {
  fromSeason: number;
  toSeason: number;
  seriesId: number;
  /** Re-ingest races even when already covered. */
  force?: boolean;
  /** ISO timestamp treated as "now" (injectable for tests). */
  nowUtc?: string;
}

function raceHasHappened(race: ScheduledRace, nowUtc: string): boolean {
  // Small buffer: a race that started less than ~6h ago may not have final data.
  const started = Date.parse(race.startTimeUtc + "Z");
  return Number.isFinite(started) && started + 6 * 60 * 60 * 1000 < Date.parse(nowUtc);
}

function raceFullyCovered(providers: Providers, race: ScheduledRace): boolean {
  if (!repo.hasResults(providers.db, race.raceId)) return false;
  if (loopStatsExpected(race.season) && !repo.hasLoopStats(providers.db, race.raceId)) return false;
  if (lapTimesExpected(race.season) && !repo.hasLapTimes(providers.db, race.raceId)) return false;
  return true;
}

/** Idempotent backfill: seasons -> schedules -> per-race feeds. Already-covered
 * races are skipped, so re-runs only fetch what's missing. */
export async function backfill(
  providers: Providers,
  opts: BackfillOptions,
  log: IngestLogger,
): Promise<void> {
  const nowUtc = opts.nowUtc ?? new Date().toISOString();
  for (let season = opts.fromSeason; season <= opts.toSeason; season++) {
    const races = await ingestSeasonSchedule(providers, season, opts.seriesId);
    if (races.length === 0) {
      log.warn(`season ${season}: no schedule available`);
      continue;
    }
    const eligible = races.filter((r) => raceHasHappened(r, nowUtc));
    let ingested = 0;
    let skipped = 0;
    for (const race of eligible) {
      if (!opts.force && raceFullyCovered(providers, race)) {
        skipped++;
        continue;
      }
      await ingestRaceData(providers, race, log);
      ingested++;
    }
    log.info(
      `season ${season}: ${races.length} scheduled, ${eligible.length} run, ` +
        `${ingested} ingested, ${skipped} already covered`,
    );
  }
}

/** Sync the current season only (post-race-weekend refresh). */
export async function syncLatest(
  providers: Providers,
  seriesId: number,
  log: IngestLogger,
  nowUtc?: string,
): Promise<void> {
  const season = new Date(nowUtc ?? Date.now()).getUTCFullYear();
  await backfill(providers, { fromSeason: season, toSeason: season, seriesId, nowUtc }, log);
}

export function coverage(providers: Providers, seriesId: number): SeasonCoverage[] {
  return repo.coverageBySeason(providers.db, seriesId);
}

import type { Providers } from "../../providers/index.ts";
import type {
  PointsResultRow,
  PointsLoopRow,
  LeagueExpectations,
  DriverSeasonStats,
  DriverTrackTypeStats,
  DriverFormRow,
  ComputeSummary,
  SeasonStanding,
  TrackTypeLeaderRow,
  FormLeader,
} from "./types.ts";
import {
  DEFAULT_SERIES_ID,
  PS_BUCKET_WIDTH,
  FORM_WINDOW_RACES,
  FORM_LEADER_MIN_SEASON_SHARE,
} from "./config.ts";
import * as repo from "./repo.ts";

type Db = Pick<Providers, "db">;

interface Log {
  info(msg: string): void;
}

// ---- Pure metric math ----

/** Bucket 0 = P1–P5, 1 = P6–P10, … Position may be fractional (avg_ps). */
export function bucketOf(position: number, width = PS_BUCKET_WIDTH): number {
  return Math.max(0, Math.floor((position - 1) / width));
}

/** Share of green-flag passing encounters won; null when a driver had none. */
export function passEfficiency(passesGf: number, passedGf: number): number | null {
  const encounters = passesGf + passedGf;
  return encounters === 0 ? null : passesGf / encounters;
}

/**
 * "Running" = finished; a failure reason = DNF. Null, blank, and
 * "Stage N Winner" oddities in the feed are treated as unknown, not DNF.
 */
export function isDnf(status: string | null): boolean {
  if (status === null) return false;
  const s = status.trim();
  return s !== "" && s !== "Running" && !s.startsWith("Stage");
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function meanByBucket(pairs: Array<{ position: number; value: number }>): Map<number, number> {
  const acc = new Map<number, { sum: number; n: number }>();
  for (const { position, value } of pairs) {
    const b = bucketOf(position);
    const cur = acc.get(b) ?? { sum: 0, n: 0 };
    cur.sum += value;
    cur.n += 1;
    acc.set(b, cur);
  }
  return new Map([...acc].map(([b, { sum, n }]) => [b, sum / n]));
}

/** League baselines computed over every points-race loop row in the dataset. */
export function buildLeagueExpectations(loops: PointsLoopRow[]): LeagueExpectations {
  const passPairs: Array<{ position: number; value: number }> = [];
  const closingPairs: Array<{ position: number; value: number }> = [];
  for (const l of loops) {
    const eff = passEfficiency(l.passesGf, l.passedGf);
    if (eff !== null) passPairs.push({ position: l.avgPs, value: eff });
    closingPairs.push({ position: l.closingPs, value: l.closingLapsDiff });
  }
  return {
    passEfficiencyByAvgPs: meanByBucket(passPairs),
    closingGainByClosingPs: meanByBucket(closingPairs),
  };
}

/** Stats shared by season and track-type aggregation. */
interface CoreAggregate {
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

function aggregate(
  results: PointsResultRow[],
  loops: PointsLoopRow[],
  exp: LeagueExpectations,
): CoreAggregate {
  const starts = results
    .map((r) => r.start)
    .filter((s): s is number => s !== null && s > 0);

  const laps = loops.reduce((a, l) => a + l.laps, 0);
  const passesGf = loops.reduce((a, l) => a + l.passesGf, 0);
  const passedGf = loops.reduce((a, l) => a + l.passedGf, 0);

  // Proprietary metrics: per-race residuals vs. the league baseline for the
  // same part of the field, averaged over the group.
  const passResiduals: number[] = [];
  const closingResiduals: number[] = [];
  for (const l of loops) {
    const eff = passEfficiency(l.passesGf, l.passedGf);
    const expEff = exp.passEfficiencyByAvgPs.get(bucketOf(l.avgPs));
    if (eff !== null && expEff !== undefined) passResiduals.push(eff - expEff);
    const expClosing = exp.closingGainByClosingPs.get(bucketOf(l.closingPs));
    if (expClosing !== undefined) closingResiduals.push(l.closingLapsDiff - expClosing);
  }
  const adjPassMean = mean(passResiduals);

  return {
    races: results.length,
    wins: results.filter((r) => r.finish === 1).length,
    top5s: results.filter((r) => r.finish <= 5).length,
    top10s: results.filter((r) => r.finish <= 10).length,
    dnfs: results.filter((r) => isDnf(r.status)).length,
    avgStart: mean(starts),
    avgFinish: mean(results.map((r) => r.finish)),
    lapsLed: results.reduce((a, r) => a + r.lapsLed, 0),
    points: results.reduce((a, r) => a + r.points, 0),
    playoffPoints: results.reduce((a, r) => a + r.playoffPoints, 0),
    loopRaces: loops.length,
    avgRating: mean(loops.map((l) => l.rating)),
    top15LapPct: laps > 0 ? loops.reduce((a, l) => a + l.top15Laps, 0) / laps : null,
    fastLapPct: laps > 0 ? loops.reduce((a, l) => a + l.fastLaps, 0) / laps : null,
    passEfficiency: passEfficiency(passesGf, passedGf),
    adjPassEfficiency: adjPassMean === null ? null : adjPassMean * 100,
    avgClosingGain: mean(loops.map((l) => l.closingLapsDiff)),
    closerScore: mean(closingResiduals),
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export function computeSeasonStats(
  results: PointsResultRow[],
  loops: PointsLoopRow[],
  exp: LeagueExpectations,
): DriverSeasonStats[] {
  const key = (r: { driverId: number; seriesId: number; season: number }) =>
    `${r.driverId}|${r.seriesId}|${r.season}`;
  const resultGroups = groupBy(results, key);
  const loopGroups = groupBy(loops, key);
  const keys = new Set([...resultGroups.keys(), ...loopGroups.keys()]);

  const out: DriverSeasonStats[] = [];
  for (const k of keys) {
    const [driverId, seriesId, season] = k.split("|").map(Number) as [number, number, number];
    out.push({
      driverId,
      seriesId,
      season,
      ...aggregate(resultGroups.get(k) ?? [], loopGroups.get(k) ?? [], exp),
    });
  }
  return out.sort((a, b) => a.season - b.season || a.driverId - b.driverId);
}

export function computeTrackTypeStats(
  results: PointsResultRow[],
  loops: PointsLoopRow[],
  exp: LeagueExpectations,
): DriverTrackTypeStats[] {
  const key = (r: {
    driverId: number;
    seriesId: number;
    season: number;
    trackType: string;
  }) => `${r.driverId}|${r.seriesId}|${r.season}|${r.trackType}`;
  const resultGroups = groupBy(results, key);
  const loopGroups = groupBy(loops, key);
  const keys = new Set([...resultGroups.keys(), ...loopGroups.keys()]);

  const out: DriverTrackTypeStats[] = [];
  for (const k of keys) {
    const parts = k.split("|");
    const rGroup = resultGroups.get(k) ?? [];
    const lGroup = loopGroups.get(k) ?? [];
    const sample = rGroup[0] ?? lGroup[0]!;
    const core = aggregate(rGroup, lGroup, exp);
    // Track-type rows drop the fields that only matter season-wide.
    const { top15LapPct: _t, fastLapPct: _f, points: _p, playoffPoints: _pp, ...rest } = core;
    out.push({
      driverId: Number(parts[0]),
      seriesId: Number(parts[1]),
      season: Number(parts[2]),
      trackType: sample.trackType,
      ...rest,
    });
  }
  return out.sort(
    (a, b) =>
      a.season - b.season ||
      a.driverId - b.driverId ||
      a.trackType.localeCompare(b.trackType),
  );
}

/** Trailing-window form per (driver, race), ordered by race date. */
export function computeForm(
  results: PointsResultRow[],
  loops: PointsLoopRow[],
  windowRaces = FORM_WINDOW_RACES,
): DriverFormRow[] {
  const loopByRaceDriver = new Map<string, PointsLoopRow>();
  for (const l of loops) loopByRaceDriver.set(`${l.raceId}|${l.driverId}`, l);

  const byDriver = groupBy(results, (r) => `${r.driverId}|${r.seriesId}`);
  const out: DriverFormRow[] = [];
  for (const rows of byDriver.values()) {
    const ordered = [...rows].sort(
      (a, b) =>
        (a.raceDateUtc ?? "").localeCompare(b.raceDateUtc ?? "") || a.raceId - b.raceId,
    );
    for (let i = 0; i < ordered.length; i++) {
      const window = ordered.slice(Math.max(0, i - windowRaces + 1), i + 1);
      const current = ordered[i]!;
      const windowLoops = window
        .map((r) => loopByRaceDriver.get(`${r.raceId}|${r.driverId}`))
        .filter((l): l is PointsLoopRow => l !== undefined);
      out.push({
        driverId: current.driverId,
        seriesId: current.seriesId,
        raceId: current.raceId,
        season: current.season,
        raceDateUtc: current.raceDateUtc,
        windowRaces: window.length,
        avgFinish: mean(window.map((r) => r.finish))!,
        avgStart: mean(
          window.map((r) => r.start).filter((s): s is number => s !== null && s > 0),
        ),
        avgRating: mean(windowLoops.map((l) => l.rating)),
        avgClosingGain: mean(windowLoops.map((l) => l.closingLapsDiff)),
      });
    }
  }
  return out;
}

// ---- Orchestration ----

/** Full recompute of every analytics table for one series. Idempotent. */
export function computeAll(p: Db, seriesId = DEFAULT_SERIES_ID, log?: Log): ComputeSummary {
  const results = repo.pointsResults(p.db, seriesId);
  const loops = repo.pointsLoopStats(p.db, seriesId);
  log?.info(`loaded ${results.length} results, ${loops.length} loop rows (points races)`);

  const exp = buildLeagueExpectations(loops);
  const seasonStats = computeSeasonStats(results, loops, exp);
  const trackTypeStats = computeTrackTypeStats(results, loops, exp);
  const form = computeForm(results, loops);

  repo.replaceSeasonStats(p.db, seriesId, seasonStats);
  repo.replaceTrackTypeStats(p.db, seriesId, trackTypeStats);
  repo.replaceForm(p.db, seriesId, form);
  log?.info(
    `computed ${seasonStats.length} season rows, ${trackTypeStats.length} track-type rows, ${form.length} form rows`,
  );

  return {
    resultRows: results.length,
    loopRows: loops.length,
    seasonStatsRows: seasonStats.length,
    trackTypeStatsRows: trackTypeStats.length,
    formRows: form.length,
  };
}

// ---- Reads over the computed tables ----

export function seasonStatsForDriver(
  p: Db,
  driverId: number,
  seriesId = DEFAULT_SERIES_ID,
): DriverSeasonStats[] {
  return repo.seasonStatsForDriver(p.db, driverId, seriesId);
}

export function seasonLeaderboard(
  p: Db,
  season: number,
  seriesId = DEFAULT_SERIES_ID,
): DriverSeasonStats[] {
  return repo.seasonStatsForSeason(p.db, season, seriesId);
}

export function trackTypeStatsForDriver(
  p: Db,
  driverId: number,
  seriesId = DEFAULT_SERIES_ID,
): DriverTrackTypeStats[] {
  return repo.trackTypeStatsForDriver(p.db, driverId, seriesId);
}

export function formForDriver(
  p: Db,
  driverId: number,
  seriesId = DEFAULT_SERIES_ID,
): DriverFormRow[] {
  return repo.formForDriver(p.db, driverId, seriesId);
}

export function standings(p: Db, season: number, seriesId = DEFAULT_SERIES_ID): SeasonStanding[] {
  return repo.standingsForSeason(p.db, season, seriesId);
}

export function trackTypeLeaderboard(
  p: Db,
  opts: {
    trackType: string;
    fromSeason: number;
    toSeason: number;
    minStarts?: number;
    seriesId?: number;
  },
): TrackTypeLeaderRow[] {
  return repo.trackTypeLeaderboard(p.db, {
    trackType: opts.trackType,
    fromSeason: opts.fromSeason,
    toSeason: opts.toSeason,
    seriesId: opts.seriesId ?? DEFAULT_SERIES_ID,
    minStarts: opts.minStarts ?? 1,
  });
}

export function formLeaders(p: Db, limit = 5, seriesId = DEFAULT_SERIES_ID): FormLeader[] {
  return repo.formLeaders(p.db, seriesId, limit, FORM_LEADER_MIN_SEASON_SHARE);
}

export function currentSeason(p: Db, seriesId = DEFAULT_SERIES_ID): number | null {
  return repo.latestSeasonWithStats(p.db, seriesId);
}

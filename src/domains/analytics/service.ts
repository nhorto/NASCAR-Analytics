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
  MetricKey,
  MetricRank,
  SeasonMetricBoard,
  RaceMetricStandout,
  RaceStandout,
  SeasonPointsResultRow,
  StandingsMovementRow,
  RaceFormCallouts,
  RaceSlot,
  PlayoffPictureRow,
  PlayoffPicture,
  PlayoffStatus,
} from "./types.ts";
import type { PlayoffFormat } from "./config.ts";
import {
  DEFAULT_SERIES_ID,
  PS_BUCKET_WIDTH,
  FORM_WINDOW_RACES,
  FORM_LEADER_MIN_SEASON_SHARE,
  METRIC_LEADER_MIN_LOOP_SHARE,
  PLAYOFF_FORMAT_BY_SERIES,
  PLAYOFF_WIN_ELIGIBILITY_RANK,
  RECAP_STANDOUT_COUNT,
  RECAP_FORM_MIN_WINDOW,
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

// ---- Weekly recap (pure) ----

/**
 * Single-race residuals for both proprietary metrics, one row per loop row. This
 * is the per-race analogue of the season aggregate: the same baselines, applied
 * to one race instead of averaged over a season. adjPE is null when a driver had
 * no green-flag passing encounters in the race.
 */
export function computeRaceStandouts(
  loops: PointsLoopRow[],
  exp: LeagueExpectations,
): RaceMetricStandout[] {
  return loops.map((l) => {
    const eff = passEfficiency(l.passesGf, l.passedGf);
    const expEff = exp.passEfficiencyByAvgPs.get(bucketOf(l.avgPs));
    const expClosing = exp.closingGainByClosingPs.get(bucketOf(l.closingPs));
    return {
      raceId: l.raceId,
      seriesId: l.seriesId,
      season: l.season,
      driverId: l.driverId,
      adjPassEfficiency: eff !== null && expEff !== undefined ? (eff - expEff) * 100 : null,
      closerScore: expClosing !== undefined ? l.closingLapsDiff - expClosing : null,
      rating: l.rating,
    };
  });
}

/** Rank driver tallies by points, then wins, then name — 1-based. */
function rankTally(m: Map<number, { name: string; points: number; wins: number }>): Map<number, number> {
  const order = [...m.entries()].sort(
    (a, b) =>
      b[1].points - a[1].points || b[1].wins - a[1].wins || a[1].name.localeCompare(b[1].name),
  );
  return new Map(order.map(([id], i) => [id, i + 1]));
}

/**
 * Championship standings after `raceId`, with movement vs. the prior race. Rows
 * come date-ordered (a race's rows are contiguous). Drivers who hadn't scored
 * before this race have `prevRank = null`; on the season's first race every
 * `rankDelta` is null.
 */
export function computeStandingsMovement(
  rows: SeasonPointsResultRow[],
  raceId: number,
  playoffCut: number,
): StandingsMovementRow[] {
  const firstIdx = rows.findIndex((r) => r.raceId === raceId);
  if (firstIdx === -1) return [];
  let lastIdx = firstIdx;
  while (lastIdx + 1 < rows.length && rows[lastIdx + 1]!.raceId === raceId) lastIdx++;

  const tally = (list: SeasonPointsResultRow[]) => {
    const m = new Map<number, { name: string; points: number; wins: number }>();
    for (const r of list) {
      const cur = m.get(r.driverId) ?? { name: r.fullName, points: 0, wins: 0 };
      cur.points += r.points;
      if (r.finish === 1) cur.wins += 1;
      m.set(r.driverId, cur);
    }
    return m;
  };

  const beforeRows = rows.slice(0, firstIdx);
  const throughRows = rows.slice(0, lastIdx + 1);
  const before = tally(beforeRows);
  const through = tally(throughRows);
  const prevRanks = rankTally(before);
  const ranks = rankTally(through);

  const thisRacePoints = new Map<number, number>();
  for (let i = firstIdx; i <= lastIdx; i++) {
    const r = rows[i]!;
    thisRacePoints.set(r.driverId, (thisRacePoints.get(r.driverId) ?? 0) + r.points);
  }

  const out: StandingsMovementRow[] = [];
  for (const [driverId, agg] of through) {
    const rank = ranks.get(driverId)!;
    const prevRank = prevRanks.get(driverId) ?? null;
    out.push({
      driverId,
      fullName: agg.name,
      points: agg.points,
      pointsThisRace: thisRacePoints.get(driverId) ?? 0,
      wins: agg.wins,
      rank,
      prevRank,
      rankDelta: prevRank === null ? null : prevRank - rank,
      inPlayoff: rank <= playoffCut,
    });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/**
 * Over- and under-performers vs. their form coming in: `delta = formAvgFinish −
 * finish` (positive = beat their recent form). Only drivers with a prior-form
 * baseline are eligible. Each side is capped at `count`, strongest first.
 */
export function pickFormCallouts(
  results: Array<{ driverId: number; fullName: string; finish: number }>,
  priorForm: Map<number, number>,
  count: number,
): RaceFormCallouts {
  const scored = results
    .filter((r) => priorForm.has(r.driverId))
    .map((r) => {
      const formAvgFinish = priorForm.get(r.driverId)!;
      return { driverId: r.driverId, fullName: r.fullName, finish: r.finish, formAvgFinish, delta: formAvgFinish - r.finish };
    });
  const over = scored
    .filter((c) => c.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, count);
  const under = scored
    .filter((c) => c.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, count);
  return { over, under };
}

// ---- Playoff picture (pure, season-phase-aware) ----

/** Per-driver season totals through a race. */
export interface DriverSeasonAgg {
  driverId: number;
  fullName: string;
  points: number;
  wins: number;
  playoffPoints: number;
}

function positionMap(sequence: RaceSlot[]): Map<number, number> {
  const m = new Map<number, number>();
  sequence.forEach((s, i) => m.set(s.raceId, i + 1));
  return m;
}

/** Season points / wins / playoff points per driver, counting races through `throughRaceId`. */
export function seasonAggregates(
  rows: SeasonPointsResultRow[],
  throughRaceId: number,
  pos: Map<number, number>,
): DriverSeasonAgg[] {
  const throughPos = pos.get(throughRaceId) ?? Number.POSITIVE_INFINITY;
  const m = new Map<number, DriverSeasonAgg>();
  for (const r of rows) {
    if ((pos.get(r.raceId) ?? Number.POSITIVE_INFINITY) > throughPos) continue;
    const cur =
      m.get(r.driverId) ??
      { driverId: r.driverId, fullName: r.fullName, points: 0, wins: 0, playoffPoints: 0 };
    cur.points += r.points;
    cur.playoffPoints += r.playoffPoints;
    if (r.finish === 1) cur.wins += 1;
    m.set(r.driverId, cur);
  }
  return [...m.values()];
}

function mkRow(a: DriverSeasonAgg, status: PlayoffStatus, pointsToCut: number | null, points = a.points): PlayoffPictureRow {
  return {
    driverId: a.driverId,
    fullName: a.fullName,
    wins: a.wins,
    points,
    playoffPoints: a.playoffPoints,
    status,
    pointsToCut,
  };
}

/**
 * Regular-season playoff field: race winners in the top-`eligibilityRank` points
 * are locked in (win and in); remaining spots go to winless drivers by points.
 * Rows are ordered locked-winners (by playoff points) → in-on-points → cut → out,
 * each carrying its points-behind-the-cut for the bubble.
 */
export function regularSeasonField(
  aggs: DriverSeasonAgg[],
  format: PlayoffFormat,
  eligibilityRank = PLAYOFF_WIN_ELIGIBILITY_RANK,
): PlayoffPictureRow[] {
  const byPoints = [...aggs].sort(
    (a, b) => b.points - a.points || a.fullName.localeCompare(b.fullName),
  );
  const pointsRank = new Map(byPoints.map((a, i) => [a.driverId, i + 1]));
  const eligible = (a: DriverSeasonAgg) => a.wins >= 1 && (pointsRank.get(a.driverId) ?? Infinity) <= eligibilityRank;

  const winners = aggs
    .filter(eligible)
    .sort((a, b) => b.playoffPoints - a.playoffPoints || b.wins - a.wins || b.points - a.points);
  const winless = aggs
    .filter((a) => !eligible(a))
    .sort((a, b) => b.points - a.points || a.fullName.localeCompare(b.fullName));

  const F = format.fieldSize;
  const rows: PlayoffPictureRow[] = [];

  // Edge: more locked winners than spots — the field is the top F winners by
  // playoff points; lower winners and all winless are out.
  if (winners.length >= F) {
    winners.forEach((a, i) =>
      rows.push(mkRow(a, i < F ? "in-win" : i === F ? "bubble" : "out", null)),
    );
    winless.forEach((a) => rows.push(mkRow(a, "out", null)));
    return rows;
  }

  const spots = F - winners.length;
  const inPoints = winless.slice(0, spots);
  const rest = winless.slice(spots);
  const cutPoints = inPoints.length > 0 ? inPoints[inPoints.length - 1]!.points : 0;

  winners.forEach((a) => rows.push(mkRow(a, "in-win", null)));
  inPoints.forEach((a) => rows.push(mkRow(a, "in-points", null)));
  rest.forEach((a, i) => rows.push(mkRow(a, i === 0 ? "bubble" : "out", cutPoints - a.points)));
  return rows;
}

/**
 * Playoff-round standings as of a playoff race: seeds the field from the
 * regular-season finale, plays each completed round (round-race points + carried
 * playoff points, race winners auto-advance), eliminates to the cut, and reports
 * the current round's standing. Eliminated drivers trail with `eliminated`.
 */
export function playoffStandings(
  rows: SeasonPointsResultRow[],
  sequence: RaceSlot[],
  format: PlayoffFormat,
  throughRaceId: number,
): PlayoffPicture {
  const pos = positionMap(sequence);
  const playoffRaceCount = format.roundRaces.reduce((a, b) => a + b, 0);
  const playoffSlots = sequence.slice(-playoffRaceCount);
  const startPos = sequence.length - playoffRaceCount; // 0-based; playoff race 1 sits at index startPos
  const finaleId = sequence[startPos - 1]?.raceId;

  const aggThrough = new Map(
    seasonAggregates(rows, throughRaceId, pos).map((a) => [a.driverId, a]),
  );

  // The 16/12/10 who qualified at the finale.
  const field =
    finaleId !== undefined
      ? regularSeasonField(seasonAggregates(rows, finaleId, pos), format).filter(
          (r) => r.status === "in-win" || r.status === "in-points",
        )
      : [];
  let survivors = field.map((r) => r.driverId);

  // Round boundaries (cumulative race counts) and which round `throughRace` is in.
  const cum: number[] = [];
  format.roundRaces.reduce((acc, n, i) => ((cum[i] = acc + n), acc + n), 0);
  const throughPlayoffPos = (pos.get(throughRaceId) ?? 0) - startPos; // 1-based within the playoffs
  let currentRound = format.roundRaces.length - 1;
  for (let i = 0; i < cum.length; i++) {
    if (throughPlayoffPos <= cum[i]!) {
      currentRound = i;
      break;
    }
  }

  const roundRaceIds = (i: number) =>
    new Set(playoffSlots.slice(i === 0 ? 0 : cum[i - 1]!, cum[i]!).map((s) => s.raceId));
  const globalPosOf = (playoffPos: number) => startPos + playoffPos; // 1-based global pos of playoff race k
  const ppThroughPos = (driverId: number, globalPos: number) => {
    let s = 0;
    for (const r of rows) if (r.driverId === driverId && (pos.get(r.raceId) ?? 0) <= globalPos) s += r.playoffPoints;
    return s;
  };
  const pointsIn = (driverId: number, ids: Set<number>) => {
    let s = 0;
    for (const r of rows) if (r.driverId === driverId && ids.has(r.raceId)) s += r.points;
    return s;
  };
  const wonIn = (driverId: number, ids: Set<number>) =>
    rows.some((r) => r.driverId === driverId && ids.has(r.raceId) && r.finish === 1);

  // Play out every round fully completed before the current one.
  for (let i = 0; i < currentRound; i++) {
    const ids = roundRaceIds(i);
    const cutoffPos = globalPosOf(cum[i]!);
    const scored = survivors.map((d) => ({
      d,
      won: wonIn(d, ids),
      score: ppThroughPos(d, cutoffPos) + pointsIn(d, ids),
    }));
    const winners = scored.filter((x) => x.won).map((x) => x.d);
    const rest = scored
      .filter((x) => !x.won)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.d);
    survivors = [...winners, ...rest].slice(0, format.roundCuts[i]!);
  }

  // Current round standing.
  const isChampionship = currentRound === format.roundRaces.length - 1;
  const sizes = [format.fieldSize, ...format.roundCuts];
  const startSize = sizes[currentRound]!;
  const cutSize = isChampionship ? startSize : format.roundCuts[currentRound]!;
  const completedThisRound = new Set(
    playoffSlots
      .slice(currentRound === 0 ? 0 : cum[currentRound - 1]!, Math.min(cum[currentRound]!, throughPlayoffPos))
      .map((s) => s.raceId),
  );
  const throughGlobalPos = globalPosOf(throughPlayoffPos);

  const standing = survivors
    .map((d) => {
      const agg = aggThrough.get(d) ?? { driverId: d, fullName: `#${d}`, points: 0, wins: 0, playoffPoints: 0 };
      const roundPoints = pointsIn(d, completedThisRound);
      return {
        agg,
        clinched: wonIn(d, completedThisRound),
        roundPoints,
        seed: ppThroughPos(d, throughGlobalPos) + roundPoints,
      };
    })
    .sort((a, b) => b.seed - a.seed || b.agg.playoffPoints - a.agg.playoffPoints || a.agg.fullName.localeCompare(b.agg.fullName));

  const clinchedCount = standing.filter((x) => x.clinched).length;
  const advanceSlots = Math.max(0, cutSize - clinchedCount);
  let nonClinchedSeen = 0;
  const cutSeed =
    !isChampionship && standing.length > cutSize
      ? [...standing].filter((x) => !x.clinched).sort((a, b) => b.seed - a.seed)[advanceSlots - 1]?.seed ?? null
      : null;

  const rows_: PlayoffPictureRow[] = standing.map((x) => {
    let status: PlayoffStatus;
    if (isChampionship) status = "advancing";
    else if (x.clinched) status = "clinched";
    else {
      const advancing = nonClinchedSeen < advanceSlots;
      nonClinchedSeen += 1;
      status = advancing ? "advancing" : "below-cut";
    }
    const toCut =
      status === "below-cut" && cutSeed !== null ? cutSeed - x.seed : null;
    return mkRow(x.agg, status, toCut, x.roundPoints);
  });

  // Eliminated drivers (qualified, no longer surviving) trail the standing.
  const survivorSet = new Set(survivors);
  for (const r of field) {
    if (!survivorSet.has(r.driverId)) {
      const agg = aggThrough.get(r.driverId) ?? { driverId: r.driverId, fullName: r.fullName, points: 0, wins: 0, playoffPoints: 0 };
      rows_.push(mkRow(agg, "eliminated", null, 0));
    }
  }

  const roundLabel = isChampionship ? `Championship ${startSize}` : `Round of ${startSize}`;
  return { phase: "playoff", roundLabel, cutSize, rows: rows_ };
}

/** Season-phase-aware playoff picture as of a race: regular-season field or playoff round. */
export function playoffPicture(
  rows: SeasonPointsResultRow[],
  sequence: RaceSlot[],
  format: PlayoffFormat,
  throughRaceId: number,
): PlayoffPicture {
  const pos = positionMap(sequence);
  const playoffRaceCount = format.roundRaces.reduce((a, b) => a + b, 0);
  const playoffIds = new Set(sequence.slice(-playoffRaceCount).map((s) => s.raceId));
  if (sequence.length >= playoffRaceCount && playoffIds.has(throughRaceId)) {
    return playoffStandings(rows, sequence, format, throughRaceId);
  }
  return {
    phase: "regular",
    roundLabel: "Regular Season",
    cutSize: format.fieldSize,
    rows: regularSeasonField(seasonAggregates(rows, throughRaceId, pos), format),
  };
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
  const raceStandouts = computeRaceStandouts(loops, exp);

  repo.replaceSeasonStats(p.db, seriesId, seasonStats);
  repo.replaceTrackTypeStats(p.db, seriesId, trackTypeStats);
  repo.replaceForm(p.db, seriesId, form);
  repo.replaceRaceStandouts(p.db, seriesId, raceStandouts);
  log?.info(
    `computed ${seasonStats.length} season rows, ${trackTypeStats.length} track-type rows, ` +
      `${form.length} form rows, ${raceStandouts.length} race-standout rows`,
  );

  return {
    resultRows: results.length,
    loopRows: loops.length,
    seasonStatsRows: seasonStats.length,
    trackTypeStatsRows: trackTypeStats.length,
    formRows: form.length,
    raceStandoutRows: raceStandouts.length,
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

// ---- Proprietary-metric leaderboards (pure ranking over precomputed rows) ----

/**
 * The loop-data regulars for a season: drivers who ran at least `share` of the
 * season's max loop-race count. Empty when nobody has loop data yet.
 */
export function qualifiedRegulars(rows: SeasonStanding[], share: number): SeasonStanding[] {
  const maxLoop = rows.reduce((m, r) => Math.max(m, r.loopRaces), 0);
  if (maxLoop === 0) return [];
  const threshold = share * maxLoop;
  return rows.filter((r) => r.loopRaces >= threshold);
}

/**
 * Rank drivers by one proprietary metric, best (highest) first. Percentile is
 * the share of the ranked field a driver beats (rank 1 → 100, last → 0). Drivers
 * with a null value for this metric are dropped from its board.
 */
export function rankByMetric(rows: SeasonStanding[], key: MetricKey): MetricRank[] {
  const scored = rows
    .map((r) => ({ r, v: r[key] }))
    .filter((x): x is { r: SeasonStanding; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v);
  const n = scored.length;
  return scored.map(({ r, v }, i) => ({
    driverId: r.driverId,
    fullName: r.fullName,
    loopRaces: r.loopRaces,
    value: v,
    rank: i + 1,
    field: n,
    percentile: n <= 1 ? 100 : Math.round(((n - 1 - i) / (n - 1)) * 100),
  }));
}

/** Both proprietary-metric leaderboards for a season, over the qualified field. */
export function seasonMetricBoard(
  p: Db,
  season: number,
  seriesId = DEFAULT_SERIES_ID,
): SeasonMetricBoard {
  const qualified = qualifiedRegulars(
    repo.standingsForSeason(p.db, season, seriesId),
    METRIC_LEADER_MIN_LOOP_SHARE,
  );
  return {
    seriesId,
    season,
    qualified: qualified.length,
    adjPass: rankByMetric(qualified, "adjPassEfficiency"),
    closer: rankByMetric(qualified, "closerScore"),
  };
}

/** A driver's rank in each proprietary metric for a season (null if unranked). */
export function driverMetricRanks(
  p: Db,
  driverId: number,
  season: number,
  seriesId = DEFAULT_SERIES_ID,
): { adjPass: MetricRank | null; closer: MetricRank | null } {
  const board = seasonMetricBoard(p, season, seriesId);
  return {
    adjPass: board.adjPass.find((m) => m.driverId === driverId) ?? null,
    closer: board.closer.find((m) => m.driverId === driverId) ?? null,
  };
}

export function currentSeason(p: Db, seriesId = DEFAULT_SERIES_ID): number | null {
  return repo.latestSeasonWithStats(p.db, seriesId);
}

// ---- Weekly recap reads ----

/** Series/season/date for a race — for the recap runtime, which can't reach the ingestion domain. */
export function raceContext(
  p: Db,
  raceId: number,
): { seriesId: number; season: number; raceDateUtc: string | null } | null {
  return repo.raceContext(p.db, raceId);
}

/** Per-race proprietary-metric standouts for one race, name-joined (adjPE first). */
export function raceStandouts(p: Db, raceId: number): RaceStandout[] {
  return repo.raceStandoutsForRace(p.db, raceId);
}

/** Championship standings + movement after one race. */
export function standingsMovement(
  p: Db,
  opts: { seriesId: number; season: number; raceId: number },
): StandingsMovementRow[] {
  const rows = repo.seasonPointsResultsWithNames(p.db, opts.seriesId, opts.season);
  const format = PLAYOFF_FORMAT_BY_SERIES[opts.seriesId] ?? PLAYOFF_FORMAT_BY_SERIES[DEFAULT_SERIES_ID]!;
  return computeStandingsMovement(rows, opts.raceId, format.fieldSize);
}

/** Season-phase-aware playoff picture as of one race (regular-season field or playoff round). */
export function playoffPictureFor(
  p: Db,
  opts: { seriesId: number; season: number; raceId: number },
): PlayoffPicture {
  const rows = repo.seasonPointsResultsWithNames(p.db, opts.seriesId, opts.season);
  const sequence = repo.seasonRaceSequence(p.db, opts.seriesId, opts.season);
  const format =
    PLAYOFF_FORMAT_BY_SERIES[opts.seriesId] ?? PLAYOFF_FORMAT_BY_SERIES[DEFAULT_SERIES_ID]!;
  return playoffPicture(rows, sequence, format, opts.raceId);
}

/** Over/under-performers vs. form coming into one race. */
export function formCallouts(
  p: Db,
  opts: { seriesId: number; season: number; raceId: number; raceDateUtc: string | null },
  count = RECAP_STANDOUT_COUNT,
): RaceFormCallouts {
  if (opts.raceDateUtc === null) return { over: [], under: [] };
  const prior = new Map(
    repo
      .priorFormForRace(p.db, {
        seriesId: opts.seriesId,
        season: opts.season,
        beforeDate: opts.raceDateUtc,
        minWindow: RECAP_FORM_MIN_WINDOW,
      })
      .map((r) => [r.driverId, r.avgFinish] as const),
  );
  const results = repo
    .seasonPointsResultsWithNames(p.db, opts.seriesId, opts.season)
    .filter((r) => r.raceId === opts.raceId)
    .map((r) => ({ driverId: r.driverId, fullName: r.fullName, finish: r.finish }));
  return pickFormCallouts(results, prior, count);
}

/** All season stats for a series (every driver, every season) — for the client compare page. */
export function allSeasonStats(p: Db, seriesId = DEFAULT_SERIES_ID): SeasonStanding[] {
  return repo.allSeasonStatsWithNames(p.db, seriesId);
}

/** All track-type season rows for a series — for the client track explorer. */
export function allTrackTypeStats(
  p: Db,
  seriesId = DEFAULT_SERIES_ID,
): Array<DriverTrackTypeStats & { fullName: string }> {
  return repo.allTrackTypeStatsWithNames(p.db, seriesId);
}

/**
 * Per-series league baselines in a JSON-friendly shape (Record keyed by bucket
 * index), for the live race companion. The live metric estimates are residuals
 * against these — the same buildLeagueExpectations math the compute run uses,
 * serialized so the edge/live layer can compare live feed inputs to league norms.
 */
export function leagueBaselines(p: Db, seriesId = DEFAULT_SERIES_ID) {
  const exp = buildLeagueExpectations(repo.pointsLoopStats(p.db, seriesId));
  return {
    seriesId,
    bucketWidth: PS_BUCKET_WIDTH,
    passEffByBucket: Object.fromEntries(exp.passEfficiencyByAvgPs) as Record<string, number>,
    closerByBucket: Object.fromEntries(exp.closingGainByClosingPs) as Record<string, number>,
  };
}

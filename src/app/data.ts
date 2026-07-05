// Compact JSON payloads for the client-rendered pages (compare, tracks).
// Served at /data/*.json by the dev server and written to dist/data/ by export.
import type { Providers } from "../providers/index.ts";
import { analyticsService } from "../domains/analytics/index.ts";

type P = Pick<Providers, "db">;

/** One row per (driver, season) — powers the client compare page. */
export function seasonStatsPayload(p: P, seriesId: number) {
  return analyticsService.allSeasonStats(p, seriesId).map((s) => ({
    id: s.driverId,
    name: s.fullName,
    season: s.season,
    races: s.races,
    wins: s.wins,
    top5s: s.top5s,
    top10s: s.top10s,
    avgStart: s.avgStart,
    avgFinish: s.avgFinish,
    avgRating: s.avgRating,
    adjPE: s.adjPassEfficiency,
    closer: s.closerScore,
    top15: s.top15LapPct,
    lapsLed: s.lapsLed,
    points: s.points,
  }));
}

/** One row per (driver, season, track-type) — powers the client track explorer. */
export function trackTypePayload(p: P, seriesId: number) {
  return analyticsService.allTrackTypeStats(p, seriesId).map((t) => ({
    id: t.driverId,
    name: t.fullName,
    season: t.season,
    type: t.trackType,
    races: t.races,
    wins: t.wins,
    top5s: t.top5s,
    avgFinish: t.avgFinish,
    avgRating: t.avgRating,
    adjPE: t.adjPassEfficiency,
    closer: t.closerScore,
    loopRaces: t.loopRaces,
  }));
}

// JSON API handlers: parse params -> call service -> Response.
import type { Providers } from "../../providers/index.ts";
import { DEFAULT_SERIES_ID } from "./config.ts";
import * as service from "./service.ts";

type Db = Pick<Providers, "db">;

/** Series query param, clamped to the three national series (default Cup). */
function seriesOf(url: URL): number {
  const s = Number.parseInt(url.searchParams.get("series") ?? "", 10);
  return s === 2 || s === 3 ? s : DEFAULT_SERIES_ID;
}

export function handleDriverStats(p: Db, idParam: string, url: URL): Response {
  const seriesId = seriesOf(url);
  const id = Number.parseInt(idParam, 10);
  if (Number.isNaN(id)) return Response.json({ error: "invalid driver id" }, { status: 400 });
  const seasons = service.seasonStatsForDriver(p, id, seriesId);
  if (seasons.length === 0) return Response.json({ error: "no stats for driver" }, { status: 404 });
  return Response.json({
    seriesId,
    seasons,
    trackTypes: service.trackTypeStatsForDriver(p, id, seriesId),
    form: service.formForDriver(p, id, seriesId),
  });
}

export function handleStandings(p: Db, seasonParam: string, url: URL): Response {
  const seriesId = seriesOf(url);
  const season = Number.parseInt(seasonParam, 10);
  if (Number.isNaN(season)) return Response.json({ error: "invalid season" }, { status: 400 });
  const standings = service.standings(p, season, seriesId);
  if (standings.length === 0) return Response.json({ error: "no data for season" }, { status: 404 });
  return Response.json({ seriesId, season, standings });
}

export function handleTrackLeaderboard(p: Db, url: URL): Response {
  const seriesId = seriesOf(url);
  const current = service.currentSeason(p, seriesId);
  if (current === null) return Response.json({ error: "no computed data" }, { status: 404 });
  const trackType = url.searchParams.get("type") ?? "road";
  const fromSeason = Number.parseInt(url.searchParams.get("from") ?? "", 10) || current - 7;
  const toSeason = Number.parseInt(url.searchParams.get("to") ?? "", 10) || current;
  const minStarts = Number.parseInt(url.searchParams.get("min") ?? "", 10) || 5;
  return Response.json({
    seriesId,
    trackType,
    fromSeason,
    toSeason,
    minStarts,
    leaders: service.trackTypeLeaderboard(p, { trackType, fromSeason, toSeason, minStarts, seriesId }),
  });
}

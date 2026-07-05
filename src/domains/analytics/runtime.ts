// JSON API handlers: parse params -> call service -> Response.
import type { Providers } from "../../providers/index.ts";
import * as service from "./service.ts";

type Db = Pick<Providers, "db">;

export function handleDriverStats(p: Db, idParam: string): Response {
  const id = Number.parseInt(idParam, 10);
  if (Number.isNaN(id)) return Response.json({ error: "invalid driver id" }, { status: 400 });
  const seasons = service.seasonStatsForDriver(p, id);
  if (seasons.length === 0) return Response.json({ error: "no stats for driver" }, { status: 404 });
  return Response.json({
    seasons,
    trackTypes: service.trackTypeStatsForDriver(p, id),
    form: service.formForDriver(p, id),
  });
}

export function handleStandings(p: Db, seasonParam: string): Response {
  const season = Number.parseInt(seasonParam, 10);
  if (Number.isNaN(season)) return Response.json({ error: "invalid season" }, { status: 400 });
  const standings = service.standings(p, season);
  if (standings.length === 0) return Response.json({ error: "no data for season" }, { status: 404 });
  return Response.json({ season, standings });
}

export function handleTrackLeaderboard(p: Db, url: URL): Response {
  const current = service.currentSeason(p);
  if (current === null) return Response.json({ error: "no computed data" }, { status: 404 });
  const trackType = url.searchParams.get("type") ?? "road";
  const fromSeason = Number.parseInt(url.searchParams.get("from") ?? "", 10) || current - 3;
  const toSeason = Number.parseInt(url.searchParams.get("to") ?? "", 10) || current;
  const minStarts = Number.parseInt(url.searchParams.get("min") ?? "", 10) || 8;
  return Response.json({
    trackType,
    fromSeason,
    toSeason,
    minStarts,
    leaders: service.trackTypeLeaderboard(p, { trackType, fromSeason, toSeason, minStarts }),
  });
}

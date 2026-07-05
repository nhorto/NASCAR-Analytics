// Bun.serve() wiring: HTML pages composed from domain services + JSON API routes.
// Cross-domain composition lives here by design — domains may not import each
// other's services, so the app layer is the only place pages can be assembled.
//
// Series (Cup/Xfinity/Trucks) is the top-level navigation axis, carried in the
// `?series=` query param (default Cup) and threaded through every page + link.
import type { Providers } from "../providers/index.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";
import { analyticsService, analyticsRuntime } from "../domains/analytics/index.ts";
import { driversService, driversRuntime } from "../domains/drivers/index.ts";
import { page, htmlResponse, notFoundPage } from "./layout.ts";
import { homeContent } from "./pages/home.ts";
import { driversIndexContent, driverProfileContent } from "./pages/drivers.ts";
import { racesIndexContent, racePageContent } from "./pages/races.ts";
import { compareContent } from "./pages/compare.ts";
import { tracksContent, type TrackSort } from "./pages/tracks.ts";

const STYLE_URL = new URL("./style.css", import.meta.url);
const SORT_KEYS: TrackSort[] = ["avgFinish", "avgRating", "adjPassEfficiency", "closerScore"];

/** Series from the URL, clamped to the three national series (default Cup). */
function parseSeries(url: URL): number {
  const s = Number.parseInt(url.searchParams.get("series") ?? "", 10);
  return s === ingestionConfig.SERIES.xfinity || s === ingestionConfig.SERIES.trucks ? s : ingestionConfig.SERIES.cup;
}

export function createServer(p: Providers, port: number) {
  const season = (seriesId: number) => analyticsService.currentSeason(p, seriesId);

  return Bun.serve({
    port,
    routes: {
      "/style.css": () =>
        new Response(Bun.file(STYLE_URL), {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        }),

      "/": (req) => {
        const seriesId = parseSeries(new URL(req.url));
        const latestRace = ingestionService.latestCompletedRace(p, seriesId);
        const latestResults = latestRace ? ingestionService.raceResults(p, latestRace.raceId) : [];
        const current = season(seriesId);
        return htmlResponse(
          page({
            title: "Home",
            active: "home",
            seriesId,
            season: current,
            content: homeContent({
              seriesId,
              latestRace,
              latestResults,
              standings:
                current === null ? [] : analyticsService.standings(p, current, seriesId).slice(0, 8),
              formLeaders: analyticsService.formLeaders(p, 5, seriesId),
            }),
          }),
        );
      },

      "/drivers": (req) => {
        const url = new URL(req.url);
        const seriesId = parseSeries(url);
        const q = url.searchParams.get("q");
        return htmlResponse(
          page({
            title: "Drivers",
            active: "drivers",
            seriesId,
            season: season(seriesId),
            content: driversIndexContent(driversService.driverIndex(p, seriesId), q, seriesId),
          }),
        );
      },

      "/drivers/:id": (req) => {
        const seriesId = parseSeries(new URL(req.url));
        const id = Number.parseInt(req.params.id, 10);
        const driver = Number.isNaN(id) ? null : driversService.findDriver(p, id, seriesId);
        if (!driver) return htmlResponse(notFoundPage(seriesId, season(seriesId), "Driver"), 404);
        return htmlResponse(
          page({
            title: driver.fullName,
            active: "drivers",
            seriesId,
            season: season(seriesId),
            content: driverProfileContent({
              seriesId,
              driver,
              seasons: analyticsService.seasonStatsForDriver(p, driver.driverId, seriesId),
              splits: analyticsService.trackTypeStatsForDriver(p, driver.driverId, seriesId),
              form: analyticsService.formForDriver(p, driver.driverId, seriesId),
              raceLog: driversService.driverRaceLog(p, driver.driverId, seriesId),
            }),
          }),
        );
      },

      "/races": (req) => {
        const url = new URL(req.url);
        const seriesId = parseSeries(url);
        const seasons = ingestionService.seasonsAvailable(p, seriesId);
        if (seasons.length === 0)
          return htmlResponse(notFoundPage(seriesId, season(seriesId), "Season data"), 404);
        const requested = Number.parseInt(url.searchParams.get("season") ?? "", 10);
        const selected = seasons.includes(requested) ? requested : seasons[0]!;
        return htmlResponse(
          page({
            title: `${selected} Races`,
            active: "races",
            seriesId,
            season: season(seriesId),
            content: racesIndexContent(
              ingestionService.seasonRaces(p, selected, seriesId),
              selected,
              seasons,
              seriesId,
            ),
          }),
        );
      },

      "/races/:id": (req) => {
        const id = Number.parseInt(req.params.id, 10);
        const race = Number.isNaN(id) ? null : ingestionService.raceDetails(p, id);
        // A race belongs to exactly one series — derive it from the race itself.
        const seriesId = race?.seriesId ?? parseSeries(new URL(req.url));
        if (!race) return htmlResponse(notFoundPage(seriesId, season(seriesId), "Race"), 404);
        return htmlResponse(
          page({
            title: race.raceName,
            active: "races",
            seriesId,
            season: season(seriesId),
            content: racePageContent(race, ingestionService.raceResults(p, race.raceId), seriesId),
          }),
        );
      },

      "/compare": (req) => {
        const url = new URL(req.url);
        const seriesId = parseSeries(url);
        const current = season(seriesId);
        const requestedSeason = Number.parseInt(url.searchParams.get("season") ?? "", 10);
        const cmpSeason = Number.isNaN(requestedSeason) ? current : requestedSeason;
        const drivers = driversService.driverIndex(p, seriesId);
        const pick = (key: string) => {
          const id = Number.parseInt(url.searchParams.get(key) ?? "", 10);
          return Number.isNaN(id) ? null : (drivers.find((d) => d.driverId === id) ?? null);
        };
        const a = pick("a");
        const b = pick("b");
        const statsFor = (driverId: number | undefined) =>
          driverId === undefined || cmpSeason === null
            ? null
            : (analyticsService
                .seasonStatsForDriver(p, driverId, seriesId)
                .find((s) => s.season === cmpSeason) ?? null);
        const seasons = ingestionService
          .seasonsAvailable(p, seriesId)
          .filter((s) => s >= ingestionConfig.BACKFILL_FIRST_SEASON);
        return htmlResponse(
          page({
            title: "Compare",
            active: "compare",
            seriesId,
            season: current,
            content: compareContent({
              seriesId,
              drivers,
              a,
              b,
              aStats: statsFor(a?.driverId),
              bStats: statsFor(b?.driverId),
              season: cmpSeason,
              seasons,
            }),
          }),
        );
      },

      "/tracks": (req) => {
        const url = new URL(req.url);
        const seriesId = parseSeries(url);
        const current = season(seriesId);
        if (current === null)
          return htmlResponse(notFoundPage(seriesId, null, "Computed data"), 404);
        const trackType = url.searchParams.get("type") ?? "road";
        // Default to the full loop-data era so every track type (incl. sparse
        // dirt) has enough starts to rank; a season-range control is future work.
        const fromSeason = Number.parseInt(url.searchParams.get("from") ?? "", 10) || current - 7;
        const toSeason = Number.parseInt(url.searchParams.get("to") ?? "", 10) || current;
        const minStarts = Number.parseInt(url.searchParams.get("min") ?? "", 10) || 5;
        const sortParam = url.searchParams.get("sort") as TrackSort | null;
        const sort: TrackSort = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : "avgFinish";
        return htmlResponse(
          page({
            title: "Track Types",
            active: "tracks",
            seriesId,
            season: current,
            content: tracksContent({
              seriesId,
              seasons: ingestionService.seasonsAvailable(p, seriesId),
              leaders: analyticsService.trackTypeLeaderboard(p, {
                trackType,
                fromSeason,
                toSeason,
                minStarts,
                seriesId,
              }),
              trackType,
              fromSeason,
              toSeason,
              minStarts,
              sort,
            }),
          }),
        );
      },

      // JSON API (domain runtime layers)
      "/api/drivers": (req) => driversRuntime.handleDriverIndex(p, new URL(req.url)),
      "/api/drivers/:id": (req) => driversRuntime.handleDriver(p, req.params.id, new URL(req.url)),
      "/api/drivers/:id/stats": (req) =>
        analyticsRuntime.handleDriverStats(p, req.params.id, new URL(req.url)),
      "/api/standings/:season": (req) =>
        analyticsRuntime.handleStandings(p, req.params.season, new URL(req.url)),
      "/api/tracks": (req) => analyticsRuntime.handleTrackLeaderboard(p, new URL(req.url)),
    },

    fetch(req) {
      const seriesId = parseSeries(new URL(req.url));
      return htmlResponse(notFoundPage(seriesId, season(seriesId), "Page"), 404);
    },
  });
}

// Bun.serve() wiring: HTML pages composed from domain services + JSON API routes.
// Cross-domain composition lives here by design — domains may not import each
// other's services, so the app layer is the only place pages can be assembled.
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

export function createServer(p: Providers, port: number) {
  const seriesId = ingestionConfig.SERIES.cup;
  const season = () => analyticsService.currentSeason(p);

  return Bun.serve({
    port,
    routes: {
      "/style.css": () =>
        new Response(Bun.file(STYLE_URL), {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        }),

      "/": () => {
        const latestRace = ingestionService.latestCompletedRace(p, seriesId);
        const latestResults = latestRace ? ingestionService.raceResults(p, latestRace.raceId) : [];
        const current = season();
        return htmlResponse(
          page({
            title: "Home",
            active: "home",
            season: current,
            content: homeContent({
              latestRace,
              latestResults,
              standings: current === null ? [] : analyticsService.standings(p, current).slice(0, 8),
              formLeaders: analyticsService.formLeaders(p, 5),
            }),
          }),
        );
      },

      "/drivers": (req) => {
        const q = new URL(req.url).searchParams.get("q");
        return htmlResponse(
          page({
            title: "Drivers",
            active: "drivers",
            season: season(),
            content: driversIndexContent(driversService.driverIndex(p), q),
          }),
        );
      },

      "/drivers/:id": (req) => {
        const id = Number.parseInt(req.params.id, 10);
        const driver = Number.isNaN(id) ? null : driversService.findDriver(p, id);
        if (!driver) return htmlResponse(notFoundPage(season(), "Driver"), 404);
        return htmlResponse(
          page({
            title: driver.fullName,
            active: "drivers",
            season: season(),
            content: driverProfileContent({
              driver,
              seasons: analyticsService.seasonStatsForDriver(p, driver.driverId),
              splits: analyticsService.trackTypeStatsForDriver(p, driver.driverId),
              form: analyticsService.formForDriver(p, driver.driverId),
              raceLog: driversService.driverRaceLog(p, driver.driverId),
            }),
          }),
        );
      },

      "/races": (req) => {
        const seasons = ingestionService.seasonsAvailable(p, seriesId);
        if (seasons.length === 0) return htmlResponse(notFoundPage(season(), "Season data"), 404);
        const requested = Number.parseInt(new URL(req.url).searchParams.get("season") ?? "", 10);
        const selected = seasons.includes(requested) ? requested : seasons[0]!;
        return htmlResponse(
          page({
            title: `${selected} Races`,
            active: "races",
            season: season(),
            content: racesIndexContent(
              ingestionService.seasonRaces(p, selected, seriesId),
              selected,
              seasons,
            ),
          }),
        );
      },

      "/races/:id": (req) => {
        const id = Number.parseInt(req.params.id, 10);
        const race = Number.isNaN(id) ? null : ingestionService.raceDetails(p, id);
        if (!race) return htmlResponse(notFoundPage(season(), "Race"), 404);
        return htmlResponse(
          page({
            title: race.raceName,
            active: "races",
            season: season(),
            content: racePageContent(race, ingestionService.raceResults(p, race.raceId)),
          }),
        );
      },

      "/compare": (req) => {
        const url = new URL(req.url);
        const current = season();
        const requestedSeason = Number.parseInt(url.searchParams.get("season") ?? "", 10);
        const cmpSeason = Number.isNaN(requestedSeason) ? current : requestedSeason;
        const drivers = driversService.driverIndex(p);
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
                .seasonStatsForDriver(p, driverId)
                .find((s) => s.season === cmpSeason) ?? null);
        const seasons = ingestionService
          .seasonsAvailable(p, seriesId)
          .filter((s) => s >= ingestionConfig.BACKFILL_FIRST_SEASON);
        return htmlResponse(
          page({
            title: "Compare",
            active: "compare",
            season: current,
            content: compareContent({
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
        const current = season();
        if (current === null) return htmlResponse(notFoundPage(null, "Computed data"), 404);
        const trackType = url.searchParams.get("type") ?? "road";
        const fromSeason =
          Number.parseInt(url.searchParams.get("from") ?? "", 10) || current - 3;
        const toSeason = Number.parseInt(url.searchParams.get("to") ?? "", 10) || current;
        const minStarts = Number.parseInt(url.searchParams.get("min") ?? "", 10) || 8;
        const sortParam = url.searchParams.get("sort") as TrackSort | null;
        const sort: TrackSort = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : "avgFinish";
        return htmlResponse(
          page({
            title: "Track Types",
            active: "tracks",
            season: current,
            content: tracksContent({
              leaders: analyticsService.trackTypeLeaderboard(p, {
                trackType,
                fromSeason,
                toSeason,
                minStarts,
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
      "/api/drivers/:id": (req) => driversRuntime.handleDriver(p, req.params.id),
      "/api/drivers/:id/stats": (req) => analyticsRuntime.handleDriverStats(p, req.params.id),
      "/api/standings/:season": (req) => analyticsRuntime.handleStandings(p, req.params.season),
      "/api/tracks": (req) => analyticsRuntime.handleTrackLeaderboard(p, new URL(req.url)),
    },

    fetch() {
      return htmlResponse(notFoundPage(season(), "Page"), 404);
    },
  });
}

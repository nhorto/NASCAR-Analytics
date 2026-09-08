// Page rendering, shared by the dev server (src/app/server.ts) and the static
// export (src/app/export.ts). Each function takes providers + a series id and
// returns an HTML string (or null for "not found"), so the same code path
// produces both the live pages and the exported files.
import type { Providers } from "../providers/index.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";
import { analyticsService } from "../domains/analytics/index.ts";
import { driversService } from "../domains/drivers/index.ts";
import { page, notFoundPage } from "./layout.ts";
import { exportBar, type ExportLink } from "./html.ts";
import { homeContent } from "./pages/home.ts";
import { driversIndexContent, driverProfileContent } from "./pages/drivers.ts";
import { racesIndexContent, racePageContent } from "./pages/races.ts";
import { compareShell } from "./pages/compare.ts";
import { tracksShell } from "./pages/tracks.ts";
import { liveShell } from "./pages/live.ts";
import { metricsContent } from "./pages/metrics.ts";
import { careerContent } from "./pages/career.ts";
import { recapContent } from "./pages/recap.ts";

type P = Pick<Providers, "db">;

const CUP = ingestionConfig.SERIES.cup;

/**
 * Whether the viewer may download this page's tables (WS-G). Tri-state on
 * purpose — see `exportBar`: null is the static export, which shows no bar.
 */
export type ViewerPro = boolean | null;

/** Prefix a page's content with its export links. */
function withExports(content: string, links: ExportLink[], pro: ViewerPro): string {
  return exportBar(links, pro) + content;
}

export function currentSeason(p: P, seriesId: number): number | null {
  return analyticsService.currentSeason(p, seriesId);
}

export function renderHome(p: P, seriesId: number, pro: ViewerPro = null): string {
  const latestRace = ingestionService.latestCompletedRace(p, seriesId);
  const latestResults = latestRace ? ingestionService.raceResults(p, latestRace.raceId) : [];
  const current = currentSeason(p, seriesId);
  return page({
    title: "Home",
    active: "home",
    seriesId,
    season: current,
    content: withExports(homeContent({
      seriesId,
      latestRace,
      latestResults,
      standings: current === null ? [] : analyticsService.standings(p, current, seriesId).slice(0, 8),
      formLeaders: analyticsService.formLeaders(p, 5, seriesId),
      metricBoard: current === null ? null : analyticsService.seasonMetricBoard(p, current, seriesId),
    }), [
      { href: `/export/standings.csv?series=${seriesId}`, label: "Standings" },
      { href: `/export/season-stats.csv?series=${seriesId}`, label: "All season stats" },
    ], pro),
  });
}

export function renderDriversIndex(
  p: P,
  seriesId: number,
  q: string | null,
  pro: ViewerPro = null,
): string {
  return page({
    title: "Drivers",
    active: "drivers",
    seriesId,
    season: currentSeason(p, seriesId),
    content: withExports(
      driversIndexContent(driversService.driverIndex(p, seriesId), q, seriesId),
      [{ href: `/export/drivers.csv?series=${seriesId}`, label: "Drivers" }],
      pro,
    ),
  });
}

/** Null when the driver has no starts in this series (→ 404). */
export function renderDriverProfile(
  p: P,
  seriesId: number,
  driverId: number,
  pro: ViewerPro = null,
): string | null {
  const driver = driversService.findDriver(p, driverId, seriesId);
  if (!driver) return null;
  const seasons = analyticsService.seasonStatsForDriver(p, driver.driverId, seriesId);
  const latest = seasons[seasons.length - 1] ?? null;
  const metricRanks = latest
    ? analyticsService.driverMetricRanks(p, driver.driverId, latest.season, seriesId)
    : { adjPass: null, closer: null };
  return page({
    title: driver.fullName,
    active: "drivers",
    seriesId,
    season: currentSeason(p, seriesId),
    content: withExports(driverProfileContent({
      seriesId,
      driver,
      seasons,
      splits: analyticsService.trackTypeStatsForDriver(p, driver.driverId, seriesId),
      form: analyticsService.formForDriver(p, driver.driverId, seriesId),
      raceLog: driversService.driverRaceLog(p, driver.driverId, seriesId),
      metricRanks,
    }), [
      { href: `/export/driver-log.csv?series=${seriesId}&driver=${driver.driverId}`, label: "Race log" },
      { href: `/export/career.csv?driver=${driver.driverId}`, label: "Career" },
    ], pro),
  });
}

/** Null when the series has no seasons. `season` defaults to the latest. */
export function renderRacesIndex(
  p: P,
  seriesId: number,
  season?: number,
  pro: ViewerPro = null,
): string | null {
  const seasons = ingestionService.seasonsAvailable(p, seriesId);
  if (seasons.length === 0) return null;
  const selected = season !== undefined && seasons.includes(season) ? season : seasons[0]!;
  return page({
    title: `${selected} Races`,
    active: "races",
    seriesId,
    season: currentSeason(p, seriesId),
    content: withExports(
      racesIndexContent(
        ingestionService.seasonRaces(p, selected, seriesId),
        selected,
        seasons,
        seriesId,
      ),
      [{ href: `/export/races.csv?series=${seriesId}&season=${selected}`, label: `${selected} races` }],
      pro,
    ),
  });
}

/**
 * Career pages are un-prefixed (driver_id is global across series). The shell's
 * series context is the driver's primary (most-started) series so the switcher
 * and season pill render coherently.
 */
export function renderCareer(p: P, driverId: number, pro: ViewerPro = null): string | null {
  const career = driversService.driverCareer(p, driverId);
  if (!career) return null;
  const primarySeries = [...career.series].sort((a, b) => b.races - a.races)[0]!.seriesId;
  return page({
    title: `${career.fullName} · Career`,
    active: "drivers",
    seriesId: primarySeries,
    season: currentSeason(p, primarySeries),
    content: withExports(
      careerContent(career),
      [{ href: `/export/career.csv?driver=${driverId}`, label: "Career" }],
      pro,
    ),
  });
}

/** Race pages are un-prefixed (race_id is globally unique); series is derived. */
export function renderRacePage(p: P, raceId: number, pro: ViewerPro = null): string | null {
  const race = ingestionService.raceDetails(p, raceId);
  if (!race) return null;
  return page({
    title: race.raceName,
    active: "races",
    seriesId: race.seriesId,
    season: currentSeason(p, race.seriesId),
    content: withExports(
      racePageContent(race, ingestionService.raceResults(p, race.raceId), race.seriesId),
      [{ href: `/export/race-results.csv?race=${race.raceId}`, label: "Results" }],
      pro,
    ),
  });
}

/**
 * Weekly recap for one race. Un-prefixed like `/race/{id}` (race_id is global);
 * series is derived from the race. Null when the race doesn't exist (→ 404).
 */
export function renderRecap(p: P, raceId: number, pro: ViewerPro = null): string | null {
  const race = ingestionService.raceDetails(p, raceId);
  if (!race) return null;
  return page({
    title: `${race.raceName} · Recap`,
    active: "recap",
    seriesId: race.seriesId,
    season: currentSeason(p, race.seriesId),
    content: withExports(recapContent({
      seriesId: race.seriesId,
      race,
      results: ingestionService.raceResults(p, race.raceId),
      standouts: analyticsService.raceStandouts(p, race.raceId),
      playoff: analyticsService.playoffPictureFor(p, {
        seriesId: race.seriesId,
        season: race.season,
        raceId: race.raceId,
      }),
      callouts: analyticsService.formCallouts(p, {
        seriesId: race.seriesId,
        season: race.season,
        raceId: race.raceId,
        raceDateUtc: race.raceDateUtc,
      }),
    }), [
      { href: `/export/race-results.csv?race=${race.raceId}`, label: "Results" },
      { href: `/export/standouts.csv?race=${race.raceId}`, label: "Standouts" },
      { href: `/export/playoff.csv?race=${race.raceId}`, label: "Playoff picture" },
    ], pro),
  });
}

/** The current series' latest completed race, as a recap. Null when the series has no races. */
export function renderLatestRecap(p: P, seriesId: number, pro: ViewerPro = null): string | null {
  const latest = ingestionService.latestCompletedRace(p, seriesId);
  return latest ? renderRecap(p, latest.raceId, pro) : null;
}

/** Null when the series has no computed stats yet (→ 404). */
export function renderMetrics(p: P, seriesId: number, pro: ViewerPro = null): string | null {
  const current = currentSeason(p, seriesId);
  if (current === null) return null;
  return page({
    title: "Metrics",
    active: "metrics",
    seriesId,
    season: current,
    content: withExports(
      metricsContent(analyticsService.seasonMetricBoard(p, current, seriesId)),
      [{ href: `/export/metrics.csv?series=${seriesId}&season=${current}`, label: `${current} metric leaders` }],
      pro,
    ),
  });
}

export function renderCompare(p: P, seriesId: number, pro: ViewerPro = null): string {
  return page({
    title: "Compare",
    active: "compare",
    seriesId,
    season: currentSeason(p, seriesId),
    content: compareShell(seriesId, pro === true),
  });
}

export function renderTracks(p: P, seriesId: number, pro: ViewerPro = null): string {
  return page({
    title: "Track Types",
    active: "tracks",
    seriesId,
    season: currentSeason(p, seriesId),
    content: tracksShell(seriesId, pro === true),
  });
}

export function renderLive(p: P, seriesId: number, pro: ViewerPro = null): string {
  return page({
    title: "Live",
    active: "live",
    seriesId,
    season: currentSeason(p, seriesId),
    content: liveShell(seriesId, pro === true),
  });
}

export function render404(seriesId: number, season: number | null, what: string): string {
  return notFoundPage(seriesId, season, what);
}

export { CUP };

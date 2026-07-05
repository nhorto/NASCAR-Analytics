// Page rendering, shared by the dev server (src/app/server.ts) and the static
// export (src/app/export.ts). Each function takes providers + a series id and
// returns an HTML string (or null for "not found"), so the same code path
// produces both the live pages and the exported files.
import type { Providers } from "../providers/index.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";
import { analyticsService } from "../domains/analytics/index.ts";
import { driversService } from "../domains/drivers/index.ts";
import { page, notFoundPage } from "./layout.ts";
import { homeContent } from "./pages/home.ts";
import { driversIndexContent, driverProfileContent } from "./pages/drivers.ts";
import { racesIndexContent, racePageContent } from "./pages/races.ts";
import { compareShell } from "./pages/compare.ts";
import { tracksShell } from "./pages/tracks.ts";
import { metricsContent } from "./pages/metrics.ts";
import { careerContent } from "./pages/career.ts";
import { recapContent } from "./pages/recap.ts";

type P = Pick<Providers, "db">;

const CUP = ingestionConfig.SERIES.cup;

export function currentSeason(p: P, seriesId: number): number | null {
  return analyticsService.currentSeason(p, seriesId);
}

export function renderHome(p: P, seriesId: number): string {
  const latestRace = ingestionService.latestCompletedRace(p, seriesId);
  const latestResults = latestRace ? ingestionService.raceResults(p, latestRace.raceId) : [];
  const current = currentSeason(p, seriesId);
  return page({
    title: "Home",
    active: "home",
    seriesId,
    season: current,
    content: homeContent({
      seriesId,
      latestRace,
      latestResults,
      standings: current === null ? [] : analyticsService.standings(p, current, seriesId).slice(0, 8),
      formLeaders: analyticsService.formLeaders(p, 5, seriesId),
      metricBoard: current === null ? null : analyticsService.seasonMetricBoard(p, current, seriesId),
    }),
  });
}

export function renderDriversIndex(p: P, seriesId: number, q: string | null): string {
  return page({
    title: "Drivers",
    active: "drivers",
    seriesId,
    season: currentSeason(p, seriesId),
    content: driversIndexContent(driversService.driverIndex(p, seriesId), q, seriesId),
  });
}

/** Null when the driver has no starts in this series (→ 404). */
export function renderDriverProfile(p: P, seriesId: number, driverId: number): string | null {
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
    content: driverProfileContent({
      seriesId,
      driver,
      seasons,
      splits: analyticsService.trackTypeStatsForDriver(p, driver.driverId, seriesId),
      form: analyticsService.formForDriver(p, driver.driverId, seriesId),
      raceLog: driversService.driverRaceLog(p, driver.driverId, seriesId),
      metricRanks,
    }),
  });
}

/** Null when the series has no seasons. `season` defaults to the latest. */
export function renderRacesIndex(p: P, seriesId: number, season?: number): string | null {
  const seasons = ingestionService.seasonsAvailable(p, seriesId);
  if (seasons.length === 0) return null;
  const selected = season !== undefined && seasons.includes(season) ? season : seasons[0]!;
  return page({
    title: `${selected} Races`,
    active: "races",
    seriesId,
    season: currentSeason(p, seriesId),
    content: racesIndexContent(
      ingestionService.seasonRaces(p, selected, seriesId),
      selected,
      seasons,
      seriesId,
    ),
  });
}

/**
 * Career pages are un-prefixed (driver_id is global across series). The shell's
 * series context is the driver's primary (most-started) series so the switcher
 * and season pill render coherently.
 */
export function renderCareer(p: P, driverId: number): string | null {
  const career = driversService.driverCareer(p, driverId);
  if (!career) return null;
  const primarySeries = [...career.series].sort((a, b) => b.races - a.races)[0]!.seriesId;
  return page({
    title: `${career.fullName} · Career`,
    active: "drivers",
    seriesId: primarySeries,
    season: currentSeason(p, primarySeries),
    content: careerContent(career),
  });
}

/** Race pages are un-prefixed (race_id is globally unique); series is derived. */
export function renderRacePage(p: P, raceId: number): string | null {
  const race = ingestionService.raceDetails(p, raceId);
  if (!race) return null;
  return page({
    title: race.raceName,
    active: "races",
    seriesId: race.seriesId,
    season: currentSeason(p, race.seriesId),
    content: racePageContent(race, ingestionService.raceResults(p, race.raceId), race.seriesId),
  });
}

/**
 * Weekly recap for one race. Un-prefixed like `/race/{id}` (race_id is global);
 * series is derived from the race. Null when the race doesn't exist (→ 404).
 */
export function renderRecap(p: P, raceId: number): string | null {
  const race = ingestionService.raceDetails(p, raceId);
  if (!race) return null;
  return page({
    title: `${race.raceName} · Recap`,
    active: "recap",
    seriesId: race.seriesId,
    season: currentSeason(p, race.seriesId),
    content: recapContent({
      seriesId: race.seriesId,
      race,
      results: ingestionService.raceResults(p, race.raceId),
      standouts: analyticsService.raceStandouts(p, race.raceId),
      movement: analyticsService.standingsMovement(p, {
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
    }),
  });
}

/** The current series' latest completed race, as a recap. Null when the series has no races. */
export function renderLatestRecap(p: P, seriesId: number): string | null {
  const latest = ingestionService.latestCompletedRace(p, seriesId);
  return latest ? renderRecap(p, latest.raceId) : null;
}

/** Null when the series has no computed stats yet (→ 404). */
export function renderMetrics(p: P, seriesId: number): string | null {
  const current = currentSeason(p, seriesId);
  if (current === null) return null;
  return page({
    title: "Metrics",
    active: "metrics",
    seriesId,
    season: current,
    content: metricsContent(analyticsService.seasonMetricBoard(p, current, seriesId)),
  });
}

export function renderCompare(p: P, seriesId: number): string {
  return page({
    title: "Compare",
    active: "compare",
    seriesId,
    season: currentSeason(p, seriesId),
    content: compareShell(seriesId),
  });
}

export function renderTracks(p: P, seriesId: number): string {
  return page({
    title: "Track Types",
    active: "tracks",
    seriesId,
    season: currentSeason(p, seriesId),
    content: tracksShell(seriesId),
  });
}

export function render404(seriesId: number, season: number | null, what: string): string {
  return notFoundPage(seriesId, season, what);
}

export { CUP };

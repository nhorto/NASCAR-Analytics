// Upstream-feed canary (`bun run canary`). Asks every NASCAR CDN endpoint
// pattern we depend on whether it still answers with the shape our own
// normalizers expect, for the most recent completed Cup race plus the live
// feeds. Exits non-zero on any failure so a scheduler (GitHub Actions today,
// the production server's cron under WS-C) can alert the owner.
//
// This is the app layer composing two domains (data-ingestion for URLs +
// normalizers, live for the live-feed parser) with the data-health runner —
// the domains themselves never import each other.
//
// Usage: bun run canary [--series 1] [--json PATH]
import { ingestionConfig, ingestionService } from "../domains/data-ingestion/index.ts";
import type { CdnLapTimesFeed, CdnLoopStatsRace, CdnScheduleEvent, CdnWeekendFeed, ScheduledRace } from "../domains/data-ingestion/index.ts";
import { liveConfig, liveService } from "../domains/live/index.ts";
import type { LiveFeed } from "../domains/live/index.ts";
import { dataHealthConfig, dataHealthService } from "../domains/data-health/index.ts";
import type { CanaryReport, FeedOutage, HealthCheck } from "../domains/data-health/index.ts";
import { createNascarCdnClient } from "../providers/nascar-cdn.ts";
import type { Providers } from "../providers/index.ts";
import type { EmailClient } from "../providers/email.ts";

const { expectArray, expectArrayAt, expectKeys, expectNormalizes, all } = dataHealthService;

const CDN = "https://cf.nascar.com";
const LIVE_FEED_URL = `${CDN}/live/feeds/live-feed.json`;
const LIVE_FLAG_URL = `${CDN}/live/feeds/live-flag-data.json`;

export interface CanaryOptions {
  seriesId: number;
  now?: () => number;
  /** Injectable transport (tests). Defaults to the rate-limited CDN client with the browser UA. */
  fetchJson?: dataHealthService.JsonFetcher;
}

interface ScheduleProbe {
  race: ScheduledRace | null;
  season: number;
  /** What the schedule endpoint(s) answered, so a dead schedule is a reported failure, not a crash. */
  status: number;
  problem: string | null;
}

/** Fetch the schedule and pick the most recent race that has passed the finality buffer. */
async function latestCompletedRace(
  fetchJson: dataHealthService.JsonFetcher,
  seriesId: number,
  now: number,
): Promise<ScheduleProbe> {
  const thisYear = new Date(now).getUTCFullYear();
  let last: ScheduleProbe = { race: null, season: thisYear, status: 0, problem: "schedule not fetched" };
  // January: the new season's feed may not exist yet, so fall back one year.
  for (const season of [thisYear, thisYear - 1]) {
    let status = 0;
    let json: unknown = null;
    try {
      ({ status, json } = await fetchJson(ingestionConfig.scheduleUrl(season, seriesId)));
    } catch (err) {
      last = { race: null, season, status: 0, problem: `transport: ${err instanceof Error ? err.message : String(err)}` };
      continue;
    }
    if (status !== 200) {
      last = { race: null, season, status, problem: `HTTP ${status}` };
      continue;
    }
    if (!Array.isArray(json)) {
      last = { race: null, season, status, problem: `expected an array, got ${json === null ? "null" : typeof json}` };
      continue;
    }
    const races = ingestionService
      .normalizeScheduledRaces(json as CdnScheduleEvent[], season)
      .filter((r) => Date.parse(r.startTimeUtc) + dataHealthConfig.RACE_FINALITY_BUFFER_MS < now)
      .sort((a, b) => Date.parse(b.startTimeUtc) - Date.parse(a.startTimeUtc));
    const race = races[0];
    if (race) return { race, season, status, problem: null };
    last = { race: null, season, status, problem: "schedule has no completed race yet" };
  }
  return last;
}

/** The concrete check list: per-race historical endpoints + the live feeds. */
export function buildChecks(race: ScheduledRace, season: number, seriesId: number): HealthCheck[] {
  const { raceId } = race;
  return [
    {
      id: "schedule",
      label: "schedule-feed",
      url: ingestionConfig.scheduleUrl(season, seriesId),
      validate: all(
        expectArray(1),
        expectNormalizes((j) => ingestionService.normalizeScheduledRaces(j as CdnScheduleEvent[], season)),
      ),
    },
    {
      id: "weekend",
      label: "weekend-feed",
      url: ingestionConfig.weekendFeedUrl(season, seriesId, raceId),
      validate: all(
        expectKeys(["weekend_race"]),
        expectNormalizes((j) => {
          const wr = (j as CdnWeekendFeed).weekend_race;
          const race0 = Array.isArray(wr) ? wr[0] : wr;
          return race0 ? ingestionService.normalizeResults(race0) : [];
        }),
      ),
    },
    {
      id: "loopstats",
      label: "loopstats",
      url: ingestionConfig.loopStatsUrl(season, seriesId, raceId),
      validate: all(
        expectArray(1),
        expectNormalizes((j) => ingestionService.normalizeLoopStats(j as CdnLoopStatsRace[])),
      ),
    },
    {
      id: "laptimes",
      label: "lap-times",
      url: ingestionConfig.lapTimesUrl(season, seriesId, raceId),
      validate: all(
        expectArrayAt("laps", 1),
        expectNormalizes((j) => ingestionService.normalizeLapTimes(raceId, j as CdnLapTimesFeed)),
      ),
    },
    {
      id: "live-feed",
      label: "live-feed",
      url: LIVE_FEED_URL,
      // Idle feeds still carry a vehicles array (last session); an empty one is
      // fine off-race. What matters is that our parser accepts the shape.
      validate: all(expectKeys(["race_id", "vehicles"]), (j) => {
        try {
          liveService.normalizeFeed(j as LiveFeed);
          return null;
        } catch (err) {
          return `normalizeFeed threw: ${err instanceof Error ? err.message : String(err)}`;
        }
      }),
    },
    { id: "live-flags", label: "live-flag-data", url: LIVE_FLAG_URL, validate: expectArray(0) },
  ];
}

export async function runCanary(opts: CanaryOptions): Promise<CanaryReport> {
  const now = opts.now ?? Date.now;
  const fetchJson = opts.fetchJson ?? defaultFetcher();
  const probe = await latestCompletedRace(fetchJson, opts.seriesId, now());
  if (!probe.race) {
    // The schedule is the root of every other check; report it as the one failure.
    const result = {
      id: "schedule",
      label: "schedule-feed",
      url: ingestionConfig.scheduleUrl(probe.season, opts.seriesId),
      status: probe.status,
      ok: false,
      problem: probe.problem,
      ms: 0,
    };
    return dataHealthService.summarize([result], new Date(now()).toISOString());
  }
  const checks = buildChecks(probe.race, probe.season, opts.seriesId);
  return dataHealthService.runChecks(checks, fetchJson, now);
}

export interface AlertOutcome {
  /** Checks currently in outage (threshold or more consecutive failures). */
  outages: FeedOutage[];
  /** Outages that crossed the threshold with THIS run — the ones emailed about. */
  alerted: FeedOutage[];
  emailDetail: string | null;
}

/**
 * Canary v1 (WS-C): persist the run to feed_status and email the owner when a
 * check crosses the consecutive-failure threshold — exactly at the crossing,
 * so one outage produces one email (and a recovery + new streak alerts again).
 */
export async function recordAndAlert(
  p: Pick<Providers, "db">,
  report: CanaryReport,
  email: { client: EmailClient; to: string | null },
): Promise<AlertOutcome> {
  dataHealthService.recordReport(p, report);
  const outages = dataHealthService.activeOutages(p);
  const alerted = dataHealthService.newlyAlertableOutages(p);
  if (alerted.length === 0) return { outages, alerted, emailDetail: null };
  const msg = dataHealthService.formatAlertEmail(alerted, report);
  const sent = await email.client.send({
    to: email.to ?? "owner@unconfigured.invalid",
    subject: msg.subject,
    text: msg.text,
  });
  return { outages, alerted, emailDetail: sent.detail };
}

/**
 * The live feeds 403 without a browser UA; the cacher paths accept it too, so
 * one client serves every check. Retries stay low: a canary should report
 * flakiness, not paper over it.
 */
function defaultFetcher(): dataHealthService.JsonFetcher {
  const cdn = createNascarCdnClient({
    delayMs: ingestionConfig.FETCH_DELAY_MS,
    retries: 1,
    retryBaseDelayMs: ingestionConfig.FETCH_RETRY_BASE_DELAY_MS,
    userAgent: liveConfig.BROWSER_UA,
  });
  return async (url) => {
    const r = await cdn.fetchJson(url);
    return { status: r.status, json: r.json };
  };
}

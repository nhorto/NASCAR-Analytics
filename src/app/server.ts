// The site server: a prefix-aware router that mirrors the static site's URL
// scheme (series in the path: /, /xfinity, /trucks). Pages come from render.ts
// and the client-page JSON from data.ts — the same code the static export uses
// — so `bun run serve` and the static fallback behave identically. Every
// response passes through the production pipeline (request id → route → gzip →
// security/cache headers → structured log); see src/app/http.ts.
import type { Providers } from "../providers/index.ts";
import { ingestionConfig, ingestionService } from "../domains/data-ingestion/index.ts";
import { analyticsRuntime } from "../domains/analytics/index.ts";
import { driversRuntime } from "../domains/drivers/index.ts";
import { htmlResponse, LIVE_API_BASE } from "./layout.ts";
import * as render from "./render.ts";
import { seasonStatsPayload, trackTypePayload, baselinesPayload } from "./data.ts";
import { dataHealthService } from "../domains/data-health/index.ts";
import { readServerEnv, type ServerConfig } from "./env.ts";
import { requestId, cacheControlFor, securityHeaders, withEncoding, injectNotice, logLine } from "./http.ts";
import { emailClientFromEnv, type EmailClient } from "../providers/email.ts";
import { resolveViewer, hasSessionCookie, type Viewer } from "./viewer.ts";
import { seriesGated, raceGated, jsonRequestBlocked, PRO_REQUIRED_BODY } from "./gate.ts";
import { handleAuthRequest } from "./auth.ts";
import { teaserContent } from "./pages/teaser.ts";
import { page, seriesLabel } from "./layout.ts";

const STYLE_URL = new URL("./style.css", import.meta.url);
const COMPARE_JS_URL = new URL("./client/compare.js", import.meta.url);
const TRACKS_JS_URL = new URL("./client/tracks.js", import.meta.url);
const LIVE_JS_URL = new URL("./client/live.js", import.meta.url);
const HOME_LIVE_JS_URL = new URL("./client/home-live.js", import.meta.url);

const SERIES = ingestionConfig.SERIES;
const VALID_SERIES = new Set<number>([SERIES.cup, SERIES.xfinity, SERIES.trucks]);

/** Split a series path prefix off the front of the pathname. */
function splitSeries(pathname: string): { seriesId: number; rest: string } {
  if (pathname === "/xfinity" || pathname.startsWith("/xfinity/"))
    return { seriesId: SERIES.xfinity, rest: pathname.slice("/xfinity".length) || "/" };
  if (pathname === "/trucks" || pathname.startsWith("/trucks/"))
    return { seriesId: SERIES.trucks, rest: pathname.slice("/trucks".length) || "/" };
  return { seriesId: SERIES.cup, rest: pathname };
}

function file(url: URL, type: string): Response {
  return new Response(Bun.file(url), { headers: { "Content-Type": type } });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function createServer(
  p: Providers,
  port: number,
  config?: ServerConfig,
  deps?: { email?: EmailClient },
) {
  const cfg = config ?? readServerEnv(process.env).config;
  const email =
    deps?.email ?? emailClientFromEnv(process.env, (m) => console.log(logLine("info", m, {}))).client;
  const bootedAt = Date.now();
  const secHeaders = securityHeaders({
    production: cfg.production,
    liveOrigin: new URL(LIVE_API_BASE).origin,
    plausibleHost: cfg.plausibleDomain ? cfg.plausibleHost : null,
  });

  const notFound = (seriesId: number, what: string) =>
    htmlResponse(render.render404(seriesId, render.currentSeason(p, seriesId), what), 404);

  // Pro teaser (WS-D): non-Pro requests to Xfinity/Trucks land here — real
  // headline, decorative blurred table, one-tap /pricing. The real rows never
  // reach a non-Pro client.
  const teaser = (seriesId: number): Response => {
    const season = render.currentSeason(p, seriesId);
    const latest = ingestionService.latestCompletedRace(p, seriesId);
    const winner = latest
      ? (ingestionService.raceResults(p, latest.raceId).find((r) => r.finish === 1) ?? null)
      : null;
    return htmlResponse(
      page({
        title: `${seriesLabel(seriesId)} — Pro`,
        active: "home",
        seriesId,
        season,
        content: teaserContent({
          seriesLabel: seriesLabel(seriesId),
          headline: {
            season,
            latestRaceName: latest?.raceName ?? null,
            winnerName: winner?.fullName ?? null,
          },
        }),
      }),
    );
  };

  const proRequired = () => json(PRO_REQUIRED_BODY, 403);

  // "Data delayed" notice (WS-C): when feed_status shows an active outage,
  // HTML pages carry a banner. The outage query is cheap but per-request would
  // still be wasteful — cache the verdict for a minute.
  const OUTAGE_CACHE_MS = 60_000;
  let outageCache = { at: -Infinity, message: null as string | null };
  const dataDelayedMessage = (): string | null => {
    const nowMs = Date.now();
    if (nowMs - outageCache.at > OUTAGE_CACHE_MS) {
      let message: string | null = null;
      try {
        const outages = dataHealthService.activeOutages(p);
        if (outages.length > 0) {
          const ids = outages.map((o) => o.checkId).join(", ");
          const since = outages[0]!.since.slice(0, 10);
          message = `Data updates are delayed — our upstream source has been failing since ${since} (${ids}). Existing stats are unaffected.`;
        }
      } catch {
        message = null; // an unreadable feed_status table must never break pages
      }
      outageCache = { at: nowMs, message };
    }
    return outageCache.message;
  };

  // Cheap liveness + freshness snapshot for Fly health checks and the uptime
  // monitor: proves the db is readable and says how current the dataset is.
  const health = (): Response => {
    try {
      const coverage = ingestionService.coverage(p, SERIES.cup);
      const latest = coverage.at(-1) ?? null;
      return json({
        ok: true,
        uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
        latestSeason: latest?.season ?? null,
        racesWithResults: latest?.racesWithResults ?? null,
      });
    } catch (err) {
      return json({ ok: false, error: String(err) }, 503);
    }
  };

  const route = (url: URL, viewer: Viewer): Response => {
      const path = url.pathname;

      if (path === "/health") return health();

      // Series-dimensioned JSON is refused for non-Pro so the teaser can't be
      // bypassed by fetching the payloads directly (WS-D).
      if (jsonRequestBlocked(url, viewer)) return proRequired();

      // --- static assets (no series prefix) ---
      if (path === "/style.css") return file(STYLE_URL, "text/css; charset=utf-8");
      if (path === "/compare.js") return file(COMPARE_JS_URL, "text/javascript; charset=utf-8");
      if (path === "/tracks.js") return file(TRACKS_JS_URL, "text/javascript; charset=utf-8");
      if (path === "/live.js") return file(LIVE_JS_URL, "text/javascript; charset=utf-8");
      if (path === "/home-live.js") return file(HOME_LIVE_JS_URL, "text/javascript; charset=utf-8");

      // --- client-page data ---
      let m = path.match(/^\/data\/season-stats-(\d+)\.json$/);
      if (m) {
        const s = Number(m[1]);
        return VALID_SERIES.has(s) ? json(seasonStatsPayload(p, s)) : json([]);
      }
      m = path.match(/^\/data\/tracktype-(\d+)\.json$/);
      if (m) {
        const s = Number(m[1]);
        return VALID_SERIES.has(s) ? json(trackTypePayload(p, s)) : json([]);
      }
      m = path.match(/^\/data\/baselines-(\d+)\.json$/);
      if (m) {
        const s = Number(m[1]);
        return VALID_SERIES.has(s) ? json(baselinesPayload(p, s)) : json(null);
      }

      // --- JSON API (dev convenience; not part of the static export) ---
      if (path === "/api/drivers") return driversRuntime.handleDriverIndex(p, url);
      m = path.match(/^\/api\/drivers\/(\d+)$/);
      if (m) return driversRuntime.handleDriver(p, m[1]!, url);
      m = path.match(/^\/api\/driver\/(\d+)\/career$/);
      if (m) return driversRuntime.handleDriverCareer(p, m[1]!);
      m = path.match(/^\/api\/drivers\/(\d+)\/stats$/);
      if (m) return analyticsRuntime.handleDriverStats(p, m[1]!, url);
      m = path.match(/^\/api\/standings\/(\d+)$/);
      if (m) return analyticsRuntime.handleStandings(p, m[1]!, url);
      if (path === "/api/tracks") return analyticsRuntime.handleTrackLeaderboard(p, url);
      if (path === "/api/metrics") return analyticsRuntime.handleMetrics(p, url);
      m = path.match(/^\/api\/recap\/(\d+)$/);
      if (m) {
        const race = ingestionService.raceDetails(p, Number(m[1]));
        if (race && raceGated(race.seriesId, viewer)) return proRequired();
        return analyticsRuntime.handleRecap(p, m[1]!);
      }

      // --- career + race pages: un-prefixed (driver_id / race_id are global) ---
      m = path.match(/^\/driver\/(\d+)$/);
      if (m) {
        const html = render.renderCareer(p, Number(m[1]));
        return html ? htmlResponse(html) : notFound(SERIES.cup, "Driver");
      }
      m = path.match(/^\/race\/(\d+)$/);
      if (m) {
        const race = ingestionService.raceDetails(p, Number(m[1]));
        if (!race) return notFound(SERIES.cup, "Race");
        if (raceGated(race.seriesId, viewer)) return teaser(race.seriesId);
        const html = render.renderRacePage(p, race.raceId);
        return html ? htmlResponse(html) : notFound(SERIES.cup, "Race");
      }
      m = path.match(/^\/recap\/(\d+)$/);
      if (m) {
        const race = ingestionService.raceDetails(p, Number(m[1]));
        if (!race) return notFound(SERIES.cup, "Recap");
        if (raceGated(race.seriesId, viewer)) return teaser(race.seriesId);
        const html = render.renderRecap(p, race.raceId);
        return html ? htmlResponse(html) : notFound(SERIES.cup, "Recap");
      }

      // --- series-prefixed HTML pages ---
      const { seriesId, rest } = splitSeries(path);
      // Free = Cup (D16): the whole Xfinity/Trucks section is one teaser wall
      // for non-Pro viewers.
      if (seriesGated(seriesId, viewer)) return teaser(seriesId);
      if (rest === "/") return htmlResponse(render.renderHome(p, seriesId));
      if (rest === "/drivers")
        return htmlResponse(render.renderDriversIndex(p, seriesId, url.searchParams.get("q")));
      m = rest.match(/^\/drivers\/(\d+)$/);
      if (m) {
        const html = render.renderDriverProfile(p, seriesId, Number(m[1]));
        return html ? htmlResponse(html) : notFound(seriesId, "Driver");
      }
      if (rest === "/races") {
        const html = render.renderRacesIndex(p, seriesId);
        return html ? htmlResponse(html) : notFound(seriesId, "Season data");
      }
      m = rest.match(/^\/races\/(\d{4})$/);
      if (m) {
        const html = render.renderRacesIndex(p, seriesId, Number(m[1]));
        return html ? htmlResponse(html) : notFound(seriesId, "Season");
      }
      if (rest === "/recap") {
        const html = render.renderLatestRecap(p, seriesId);
        return html ? htmlResponse(html) : notFound(seriesId, "Recap");
      }
      if (rest === "/metrics") {
        const html = render.renderMetrics(p, seriesId);
        return html ? htmlResponse(html) : notFound(seriesId, "Metrics");
      }
      if (rest === "/compare") return htmlResponse(render.renderCompare(p, seriesId));
      if (rest === "/tracks") return htmlResponse(render.renderTracks(p, seriesId));
      if (rest === "/live") return htmlResponse(render.renderLive(p, seriesId));

      return notFound(seriesId, "Page");
  };

  const authDeps = {
    email,
    baseUrl: () => cfg.appBaseUrl ?? server.url.origin,
    production: cfg.production,
  };

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const id = requestId(req);
      const start = performance.now();
      let res: Response;
      try {
        const viewer = resolveViewer(p, req, new Date());
        res = (await handleAuthRequest(p, req, url, viewer, authDeps)) ?? route(url, viewer);
      } catch (err) {
        console.error(
          logLine("error", "unhandled route error", { id, path: url.pathname, error: String(err) }),
        );
        res = new Response("Internal server error", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      if (res.status === 200 && (res.headers.get("Content-Type") ?? "").startsWith("text/html")) {
        const message = dataDelayedMessage();
        if (message)
          res = new Response(injectNotice(await res.text(), message), {
            status: res.status,
            headers: res.headers,
          });
      }
      res = await withEncoding(req, res);
      res.headers.set("X-Request-Id", id);
      res.headers.set(
        "Cache-Control",
        cacheControlFor(url.pathname, res.status, { privateViewer: hasSessionCookie(req) }),
      );
      for (const [k, v] of Object.entries(secHeaders)) res.headers.set(k, v);
      if (cfg.logRequests)
        console.log(
          logLine("info", "request", {
            id,
            method: req.method,
            path: url.pathname,
            status: res.status,
            ms: Math.round((performance.now() - start) * 10) / 10,
          }),
        );
      return res;
    },
  });
  return server;
}

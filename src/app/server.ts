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
import { readServerEnv, type ServerConfig } from "./env.ts";
import { requestId, cacheControlFor, securityHeaders, withEncoding, logLine } from "./http.ts";

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

export function createServer(p: Providers, port: number, config?: ServerConfig) {
  const cfg = config ?? readServerEnv(process.env).config;
  const bootedAt = Date.now();
  const secHeaders = securityHeaders({
    production: cfg.production,
    liveOrigin: new URL(LIVE_API_BASE).origin,
    plausibleHost: cfg.plausibleDomain ? cfg.plausibleHost : null,
  });

  const notFound = (seriesId: number, what: string) =>
    htmlResponse(render.render404(seriesId, render.currentSeason(p, seriesId), what), 404);

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

  const route = (url: URL): Response => {
      const path = url.pathname;

      if (path === "/health") return health();

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
      if (m) return analyticsRuntime.handleRecap(p, m[1]!);

      // --- career + race pages: un-prefixed (driver_id / race_id are global) ---
      m = path.match(/^\/driver\/(\d+)$/);
      if (m) {
        const html = render.renderCareer(p, Number(m[1]));
        return html ? htmlResponse(html) : notFound(SERIES.cup, "Driver");
      }
      m = path.match(/^\/race\/(\d+)$/);
      if (m) {
        const html = render.renderRacePage(p, Number(m[1]));
        return html ? htmlResponse(html) : notFound(SERIES.cup, "Race");
      }
      m = path.match(/^\/recap\/(\d+)$/);
      if (m) {
        const html = render.renderRecap(p, Number(m[1]));
        return html ? htmlResponse(html) : notFound(SERIES.cup, "Recap");
      }

      // --- series-prefixed HTML pages ---
      const { seriesId, rest } = splitSeries(path);
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

  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const id = requestId(req);
      const start = performance.now();
      let res: Response;
      try {
        res = route(url);
      } catch (err) {
        console.error(
          logLine("error", "unhandled route error", { id, path: url.pathname, error: String(err) }),
        );
        res = new Response("Internal server error", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      res = await withEncoding(req, res);
      res.headers.set("X-Request-Id", id);
      res.headers.set("Cache-Control", cacheControlFor(url.pathname, res.status));
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
}

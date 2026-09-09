// Pure HTTP hardening helpers for the production server: request ids,
// per-route-class Cache-Control, security headers, gzip, structured log lines.
// Everything here is a pure function over (Request, Response, config) so it is
// unit-testable without a socket; server.ts composes them into the pipeline.

/** Honor an upstream request id (Fly injects fly-request-id) or mint one. */
export function requestId(req: Request): string {
  return req.headers.get("x-request-id") ?? req.headers.get("fly-request-id") ?? crypto.randomUUID();
}

export type CacheClass =
  | "health" | "asset" | "data" | "page" | "error" | "auth" | "download" | "worker" | "viewer";

// Auth-owned routes are never cacheable anywhere (they set cookies, carry
// per-user state, or consume single-use tokens). Unsubscribe links and the
// provider webhook join them: both mutate state from a bare URL.
const AUTH_PATH = /^\/(signup|signin|reset(\/|$)|verify\/|account$|auth\/|unsubscribe\/|webhooks\/)/;

/**
 * Endpoints whose **200 body differs by entitlement**. These can never be
 * shared-cacheable, not even for an anonymous request: the free body is a
 * different document, so any client cache will replay it to the same client
 * after they sign in and become Pro.
 *
 * Found on a real device (2026-09-09 Android drive): `/api/predictions` was
 * `public, max-age=300` while anonymous, so a viewer who subscribed kept
 * seeing "39 more drivers with Pro" — served from the app's HTTP cache,
 * without a request reaching the server — for up to five minutes.
 *
 * Endpoints that *refuse* rather than trim (403 `/api/dfs`, the series JSON)
 * are already safe: an error response is `no-store`, and the Pro 200 carries a
 * session cookie and so is `private`.
 */
const VIEWER_VARYING_PATH = /^\/api\/predictions$/;

export function cacheClassFor(path: string, status: number): CacheClass {
  if (AUTH_PATH.test(path)) return "auth";
  if (status >= 400) return "error";
  // CSV exports are Pro-gated and viewer-specific — never shared-cacheable.
  if (path.startsWith("/export/")) return "download";
  // The service worker must revalidate every load: a cached sw.js is a site
  // that can never be updated, because the new worker is never fetched.
  if (path === "/sw.js" || path === "/manifest.webmanifest") return "worker";
  if (path === "/health") return "health";
  if (path === "/style.css" || /^\/[a-z-]+\.js$/.test(path)) return "asset";
  if (VIEWER_VARYING_PATH.test(path)) return "viewer";
  if (path.startsWith("/data/") || path.startsWith("/api/")) return "data";
  return "page";
}

// Assets are ?v=-versioned (ASSET_VERSION), so a day of caching is safe; pages
// and data refresh weekly at most, but keep edge TTLs short so a mid-week
// correction propagates within minutes.
const CACHE_CONTROL: Record<CacheClass, string> = {
  health: "no-store",
  error: "no-store",
  auth: "private, no-store",
  download: "private, no-store",
  viewer: "private, no-store",
  worker: "public, max-age=0, must-revalidate",
  asset: "public, max-age=86400",
  data: "public, max-age=300",
  page: "public, max-age=300, stale-while-revalidate=600",
};

/**
 * `privateViewer` = the request carried a session cookie: page/data responses
 * become per-user (gating, account state) and must not enter shared caches.
 * Static assets stay public — they're identical for everyone.
 */
export function cacheControlFor(
  path: string,
  status: number,
  opts?: { privateViewer?: boolean },
): string {
  const cls = cacheClassFor(path, status);
  if (opts?.privateViewer && (cls === "page" || cls === "data")) return "private, no-store";
  return CACHE_CONTROL[cls];
}

export interface SecurityHeaderOpts {
  production: boolean;
  /** Origin of the live Worker — the page fetches /api/live cross-origin. */
  liveOrigin: string | null;
  /** Plausible host, only when analytics is enabled. */
  plausibleHost: string | null;
}

export function securityHeaders(opts: SecurityHeaderOpts): Record<string, string> {
  const connect = ["'self'", opts.liveOrigin, opts.plausibleHost].filter(Boolean).join(" ");
  // No 'unsafe-inline' (WS-I): every script is an external file and every
  // former on*= handler is a delegated listener in client/boot.js. Page config
  // travels as `<html data-*>` attributes, so nothing needs a per-page hash.
  // A rendered-HTML test fails if an inline script or handler comes back.
  //
  // style-src keeps 'unsafe-inline' on purpose: metric bars and car badges
  // compute width/background per row, which is not expressible as a class.
  // Values there are numbers and our own palette entries, never user input.
  const script = ["'self'", opts.plausibleHost].filter(Boolean).join(" ");
  const headers: Record<string, string> = {
    "Content-Security-Policy":
      `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; ` +
      `img-src 'self' data:; connect-src ${connect}; frame-ancestors 'none'; ` +
      `base-uri 'self'; form-action 'self'`,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (opts.production) headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains";
  return headers;
}

const COMPRESSIBLE_TYPE = /^(text\/|application\/json)/;
export const GZIP_MIN_BYTES = 1024;

/**
 * Gzip a compressible response when the client accepts it. Always marks
 * compressible responses `Vary: Accept-Encoding` so caches key correctly.
 * Consumes the input body (all our responses are locally constructed).
 */
export async function withEncoding(req: Request, res: Response): Promise<Response> {
  const type = res.headers.get("Content-Type") ?? "";
  if (!COMPRESSIBLE_TYPE.test(type) || res.headers.has("Content-Encoding")) return res;
  res.headers.set("Vary", "Accept-Encoding");
  const accept = req.headers.get("Accept-Encoding") ?? "";
  if (!/\bgzip\b/.test(accept)) return res;
  // Streamed downloads (CSV exports) must not be buffered — `arrayBuffer()`
  // below would wait for the last row before sending the first byte. Pipe them
  // through a streaming compressor instead.
  if (res.headers.has("Content-Disposition") && res.body) {
    const streamHeaders = new Headers(res.headers);
    streamHeaders.set("Content-Encoding", "gzip");
    streamHeaders.delete("Content-Length");
    return new Response(res.body.pipeThrough(new CompressionStream("gzip")), {
      status: res.status,
      headers: streamHeaders,
    });
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < GZIP_MIN_BYTES)
    return new Response(buf, { status: res.status, headers: res.headers });
  const headers = new Headers(res.headers);
  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");
  return new Response(Bun.gzipSync(buf), { status: res.status, headers });
}

/** Insert a site-wide notice card right after the opening <main> tag (the
 * "data delayed" banner, WS-C). No-op when the marker is absent (bare pages). */
export function injectNotice(html: string, message: string): string {
  const marker = `<main class="screen">`;
  const idx = html.indexOf(marker);
  if (idx === -1) return html;
  const banner = `\n<div class="card" role="status" data-notice="data-delayed"><p class="note">⚠ ${message}</p></div>`;
  return html.slice(0, idx + marker.length) + banner + html.slice(idx + marker.length);
}

export interface RequestLogFields {
  id: string;
  method: string;
  path: string;
  status: number;
  ms: number;
}

/** One JSON log line per request — greppable on Fly, parseable anywhere. */
export function logLine(level: "info" | "error", msg: string, fields: Record<string, unknown>): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
}

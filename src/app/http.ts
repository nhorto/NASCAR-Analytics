// Pure HTTP hardening helpers for the production server: request ids,
// per-route-class Cache-Control, security headers, gzip, structured log lines.
// Everything here is a pure function over (Request, Response, config) so it is
// unit-testable without a socket; server.ts composes them into the pipeline.

/** Honor an upstream request id (Fly injects fly-request-id) or mint one. */
export function requestId(req: Request): string {
  return req.headers.get("x-request-id") ?? req.headers.get("fly-request-id") ?? crypto.randomUUID();
}

export type CacheClass = "health" | "asset" | "data" | "page" | "error" | "auth";

// Auth-owned routes are never cacheable anywhere (they set cookies, carry
// per-user state, or consume single-use tokens).
const AUTH_PATH = /^\/(signup|signin|reset(\/|$)|verify\/|account$|auth\/)/;

export function cacheClassFor(path: string, status: number): CacheClass {
  if (AUTH_PATH.test(path)) return "auth";
  if (status >= 400) return "error";
  if (path === "/health") return "health";
  if (path === "/style.css" || /^\/[a-z-]+\.js$/.test(path)) return "asset";
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
  // 'unsafe-inline' covers the small bootstrap scripts in layout.ts; replacing
  // them with hashes is logged in the tech-debt tracker for WS-I.
  const script = ["'self'", "'unsafe-inline'", opts.plausibleHost].filter(Boolean).join(" ");
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

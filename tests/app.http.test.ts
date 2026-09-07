// HTTP hardening helpers: cache classes, security headers, request ids, gzip.
import { describe, expect, test } from "bun:test";
import {
  requestId,
  cacheClassFor,
  cacheControlFor,
  securityHeaders,
  withEncoding,
  logLine,
  GZIP_MIN_BYTES,
} from "../src/app/http.ts";

describe("requestId", () => {
  test("honors x-request-id, then fly-request-id, else mints a UUID", () => {
    expect(requestId(new Request("http://x/", { headers: { "x-request-id": "abc" } }))).toBe("abc");
    expect(requestId(new Request("http://x/", { headers: { "fly-request-id": "fly1" } }))).toBe(
      "fly1",
    );
    const minted = requestId(new Request("http://x/"));
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("cache control", () => {
  test("route classes map as designed", () => {
    expect(cacheClassFor("/health", 200)).toBe("health");
    expect(cacheClassFor("/style.css", 200)).toBe("asset");
    expect(cacheClassFor("/live.js", 200)).toBe("asset");
    expect(cacheClassFor("/data/season-stats-1.json", 200)).toBe("data");
    expect(cacheClassFor("/api/drivers", 200)).toBe("data");
    expect(cacheClassFor("/", 200)).toBe("page");
    expect(cacheClassFor("/xfinity/drivers/1", 200)).toBe("page");
    // Errors are never cacheable, whatever the path.
    expect(cacheClassFor("/", 404)).toBe("error");
    expect(cacheClassFor("/api/drivers", 500)).toBe("error");
  });

  test("exact header values", () => {
    expect(cacheControlFor("/health", 200)).toBe("no-store");
    expect(cacheControlFor("/style.css", 200)).toBe("public, max-age=86400");
    expect(cacheControlFor("/api/drivers", 200)).toBe("public, max-age=300");
    expect(cacheControlFor("/", 200)).toBe("public, max-age=300, stale-while-revalidate=600");
    expect(cacheControlFor("/nope", 404)).toBe("no-store");
  });
});

describe("securityHeaders", () => {
  test("CSP includes the live origin and plausible host when given", () => {
    const h = securityHeaders({
      production: false,
      liveOrigin: "https://live.example.com",
      plausibleHost: "https://plausible.io",
    });
    const csp = h["Content-Security-Policy"]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://live.example.com https://plausible.io");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://plausible.io");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("null origins are omitted from CSP", () => {
    const csp = securityHeaders({ production: false, liveOrigin: null, plausibleHost: null })[
      "Content-Security-Policy"
    ]!;
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
  });

  test("HSTS only in production", () => {
    const dev = securityHeaders({ production: false, liveOrigin: null, plausibleHost: null });
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
    const prod = securityHeaders({ production: true, liveOrigin: null, plausibleHost: null });
    expect(prod["Strict-Transport-Security"]).toBe("max-age=15552000; includeSubDomains");
  });
});

describe("withEncoding", () => {
  const html = (body: string) =>
    new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  const gzipReq = new Request("http://x/", { headers: { "Accept-Encoding": "gzip, br" } });
  const plainReq = new Request("http://x/");

  test("gzips a large compressible body and round-trips exactly", async () => {
    const body = "<html>" + "x".repeat(GZIP_MIN_BYTES * 2) + "</html>";
    const res = await withEncoding(gzipReq, html(body));
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(res.headers.get("Vary")).toBe("Accept-Encoding");
    const raw = new Uint8Array(await res.arrayBuffer());
    expect(raw.byteLength).toBeLessThan(body.length);
    expect(new TextDecoder().decode(Bun.gunzipSync(raw))).toBe(body);
  });

  test("skips small bodies but still marks Vary", async () => {
    const res = await withEncoding(gzipReq, html("<html>tiny</html>"));
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Accept-Encoding");
    expect(await res.text()).toBe("<html>tiny</html>");
  });

  test("skips when the client does not accept gzip", async () => {
    const body = "y".repeat(GZIP_MIN_BYTES * 2);
    const res = await withEncoding(plainReq, html(body));
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(await res.text()).toBe(body);
  });

  test("never touches non-compressible types", async () => {
    const png = new Response("z".repeat(GZIP_MIN_BYTES * 2), {
      headers: { "Content-Type": "image/png" },
    });
    const res = await withEncoding(gzipReq, png);
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("Vary")).toBeNull();
  });

  test("gzips JSON too", async () => {
    const body = JSON.stringify({ rows: Array(500).fill("row") });
    const res = await withEncoding(
      gzipReq,
      new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } }),
    );
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
  });
});

describe("logLine", () => {
  test("emits one parseable JSON object with ts/level/msg and fields", () => {
    const parsed = JSON.parse(logLine("info", "request", { id: "r1", status: 200 }));
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("request");
    expect(parsed.id).toBe("r1");
    expect(parsed.status).toBe(200);
    expect(new Date(parsed.ts).toString()).not.toBe("Invalid Date");
  });
});

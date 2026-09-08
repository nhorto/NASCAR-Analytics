import { esc, withSeries, ASSET_VERSION } from "./html.ts";
import { installBanner } from "./pwa.ts";

/** Origin of the live-companion Worker (Phase 2/3). The site fetches its
 *  /api/live cross-origin (CORS is open on the Worker). Env-overridable so the
 *  Worker can move accounts/domains (launch plan D12/D17) without a code edit;
 *  the server's CSP connect-src derives from this same value. */
export const LIVE_API_BASE =
  process.env.LIVE_API_BASE?.replace(/\/$/, "") || "https://looplab-live.nhorton.workers.dev";

/**
 * Privacy-respecting aggregate analytics (Plausible: no cookies, no cross-site
 * tracking). Emitted only when PLAUSIBLE_DOMAIN is set at render/export time,
 * so local dev and tests stay silent. WS-A of the launch plan.
 */
export function analyticsTag(): string {
  const domain = process.env.PLAUSIBLE_DOMAIN;
  if (!domain) return "";
  const host = process.env.PLAUSIBLE_HOST ?? "https://plausible.io";
  return `\n<script defer data-domain="${esc(domain)}" src="${esc(host)}/js/script.js"></script>`;
}

export type Tab = "home" | "recap" | "metrics" | "drivers" | "live" | "races" | "compare" | "tracks";

const TABS: Array<{ id: Tab; href: string; icon: string; label: string }> = [
  { id: "home", href: "/", icon: "⌂", label: "Home" },
  { id: "recap", href: "/recap", icon: "❑", label: "Recap" },
  { id: "metrics", href: "/metrics", icon: "◈", label: "Metrics" },
  { id: "drivers", href: "/drivers", icon: "◔", label: "Drivers" },
  { id: "live", href: "/live", icon: "◉", label: "Live" },
  { id: "races", href: "/races", icon: "⚑", label: "Races" },
  { id: "compare", href: "/compare", icon: "⇄", label: "Compare" },
  { id: "tracks", href: "/tracks", icon: "◎", label: "Tracks" },
];

/** The three national series — the top-level switcher, orthogonal to section tabs. */
export const SERIES_TABS: Array<{ id: number; label: string; short: string }> = [
  { id: 1, label: "Cup Series", short: "Cup" },
  { id: 2, label: "Xfinity Series", short: "Xfinity" },
  { id: 3, label: "Truck Series", short: "Trucks" },
];

export function seriesLabel(seriesId: number): string {
  return SERIES_TABS.find((s) => s.id === seriesId)?.label ?? "Cup Series";
}

/** Where a series switch lands: the current section's index for the new series. */
function sectionIndex(tab: Tab): string {
  return tab === "home" ? "/" : `/${tab}`;
}

export function page(opts: {
  title: string;
  active: Tab;
  seriesId: number;
  season: number | null;
  content: string;
  /** Viewer's plan, published to the client via `<html data-pro>` (WS-I). */
  pro?: boolean;
}): string {
  const tabs = TABS.map((t) => {
    const cls = [t.id === opts.active ? "on" : "", t.id === "live" ? "tab-live" : ""].filter(Boolean).join(" ");
    const dot = t.id === "live" ? `<i class="livedot" hidden></i>` : "";
    return `<a href="${withSeries(t.href, opts.seriesId)}" class="${cls}"><span>${t.icon}</span>${t.label}${dot}</a>`;
  }).join("");
  const seriesSwitch = SERIES_TABS.map(
    (s) =>
      `<a href="${withSeries(sectionIndex(opts.active), s.id)}" class="${s.id === opts.seriesId ? "on" : ""}">${s.short}</a>`,
  ).join("");
  // Page config rides on <html> (not <body>, not an inline script) so boot.js
  // can read it from <head> before any in-body page script runs — that is what
  // lets the CSP drop 'unsafe-inline' from script-src. See client/boot.js.
  return `<!doctype html>
<html lang="en" data-live-api="${esc(LIVE_API_BASE)}" data-series="${opts.seriesId}" data-pro="${opts.pro ? "true" : "false"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(opts.title)} · Looplab</title>
<link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a0c10">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Looplab">
<script src="/boot.js?v=${ASSET_VERSION}"></script>${analyticsTag()}
</head>
<body>
<div class="shell">
  <header class="appbar">
    <a class="wordmark" href="${withSeries("/", opts.seriesId)}">Loop<em>lab</em></a>
    <span class="season-pill num">${opts.season ?? "—"} Season</span>
    <a class="account-link" href="/account" aria-label="Account">⦿</a>
  </header>
  <nav class="series-switch seg">${seriesSwitch}</nav>
  <main class="screen">
${installBanner()}
${opts.content}
  </main>
  <nav class="tabbar">${tabs}</nav>
</div>
<script src="/install.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function notFoundPage(seriesId: number, season: number | null, what: string): string {
  return page({
    title: "Not found",
    active: "home",
    seriesId,
    season,
    content: `<div class="card"><div class="card-h"><h3>404</h3></div><p class="note">${esc(what)} not found.</p><p class="note" style="margin-top:8px"><a href="${withSeries("/", seriesId)}">← Back home</a></p></div>`,
  });
}

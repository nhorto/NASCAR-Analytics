import { esc, navIcon, withSeries, ASSET_VERSION } from "./html.ts";
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

export type Tab =
  | "home"
  | "recap"
  | "metrics"
  | "drivers"
  | "live"
  | "races"
  | "compare"
  | "tracks"
  | "predictions"
  | "dfs"
  | "stats"
  | "account";

/**
 * The five mobile tabs — the same navigation as the native app (2026-09-09 UX
 * realignment), so a fan moving between the app and the mobile site meets one
 * structure. Every page maps into one of these groups for tab highlighting;
 * the desktop sidenav highlights the exact page instead.
 */
type TabGroup = "home" | "live" | "picks" | "stats" | "account";

const TAB_GROUP: Record<Tab, TabGroup> = {
  home: "home",
  live: "live",
  predictions: "picks",
  dfs: "picks",
  recap: "stats",
  metrics: "stats",
  drivers: "stats",
  races: "stats",
  compare: "stats",
  tracks: "stats",
  stats: "stats",
  account: "account",
};

const MOBILE_TABS: Array<{ id: TabGroup; href: string; icon: string; label: string; unprefixed?: boolean }> = [
  { id: "home", href: "/", icon: "home", label: "Home" },
  { id: "live", href: "/live", icon: "live", label: "Live" },
  { id: "picks", href: "/predictions", icon: "picks", label: "Picks" },
  { id: "stats", href: "/stats", icon: "stats", label: "Stats" },
  { id: "account", href: "/account", icon: "account", label: "Account", unprefixed: true },
];

/** Desktop sidenav: grouped, exact-page entries — the full IA the five mobile tabs condense. */
const SIDENAV_GROUPS: Array<{
  grp: string | null;
  items: Array<{ id: Tab; href: string; icon: string; label: string; pro?: boolean }>;
}> = [
  { grp: null, items: [{ id: "home", href: "/", icon: "home", label: "Home" }] },
  {
    grp: "Race weekend",
    items: [
      { id: "live", href: "/live", icon: "live", label: "Live" },
      { id: "predictions", href: "/predictions", icon: "predictions", label: "Predictions" },
      { id: "dfs", href: "/dfs", icon: "dfs", label: "DFS", pro: true },
    ],
  },
  {
    grp: "Results",
    items: [
      { id: "recap", href: "/recap", icon: "recap", label: "Recap" },
      { id: "races", href: "/races", icon: "races", label: "Races" },
    ],
  },
  {
    grp: "Stats",
    items: [
      { id: "drivers", href: "/drivers", icon: "drivers", label: "Drivers" },
      { id: "metrics", href: "/metrics", icon: "metrics", label: "Metrics" },
    ],
  },
  {
    grp: "Tools",
    items: [
      { id: "compare", href: "/compare", icon: "compare", label: "Compare" },
      { id: "tracks", href: "/tracks", icon: "tracks", label: "Track types" },
    ],
  },
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

/** Where a series switch lands: the current section's index for the new series.
 *  Account pages are un-prefixed, so switching series from one goes home. */
function sectionIndex(tab: Tab): string {
  if (tab === "home" || tab === "account") return "/";
  return `/${tab}`;
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
  const group = TAB_GROUP[opts.active];
  const tabs = MOBILE_TABS.map((t) => {
    const cls = [t.id === group ? "on" : "", t.id === "live" ? "tab-live" : ""].filter(Boolean).join(" ");
    const dot = t.id === "live" ? `<i class="livedot" hidden></i>` : "";
    const href = t.unprefixed ? t.href : withSeries(t.href, opts.seriesId);
    return `<a href="${href}" class="${cls}"><span>${navIcon(t.icon)}</span>${t.label}${dot}</a>`;
  }).join("");
  const seriesSwitch = SERIES_TABS.map(
    (s) =>
      `<a href="${withSeries(sectionIndex(opts.active), s.id)}" class="${s.id === opts.seriesId ? "on" : ""}">${s.short}</a>`,
  ).join("");
  // Desktop-only sidenav (hidden < 900px): exact-page highlighting, grouped
  // entries, its own series switch (locks on Pro series for free viewers) and
  // account footer — the appbar + series-switch + tabbar hide at that width.
  const sideItems = SIDENAV_GROUPS.map(({ grp, items }) => {
    const links = items
      .map((it) => {
        const dot = it.id === "live" ? `<i class="livedot" hidden></i>` : "";
        const pro = it.pro && !opts.pro ? `<span class="propill">Pro</span>` : "";
        return `<a href="${withSeries(it.href, opts.seriesId)}" class="${it.id === opts.active ? "on" : ""}">${navIcon(it.icon)}<span>${it.label}</span>${dot}${pro}</a>`;
      })
      .join("");
    return `${grp ? `<div class="grp">${grp}</div>` : ""}${links}`;
  }).join("");
  const sideSeries = SERIES_TABS.map(
    (s) =>
      `<a href="${withSeries(sectionIndex(opts.active), s.id)}" class="${s.id === opts.seriesId ? "on" : ""}">${s.short}${s.id !== 1 && !opts.pro ? `<span class="slock">🔒</span>` : ""}</a>`,
  ).join("");
  const sidenav = `<aside class="sidenav">
    <div class="side-top"><a class="wordmark" href="${withSeries("/", opts.seriesId)}">Loop<em>lab</em></a><span class="season-pill num">${opts.season ?? "—"}</span></div>
    <nav class="seg side-series">${sideSeries}</nav>
    <nav class="snav">${sideItems}</nav>
    <div class="foot"><a class="foot-account" href="/account">${navIcon("account")}<span>Account</span></a>${opts.pro ? `<span class="plan-chip pro">Pro</span>` : `<a class="gopro" href="/pricing">Go Pro →</a>`}</div>
  </aside>`;
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
${sidenav}
  <header class="appbar">
    <a class="wordmark" href="${withSeries("/", opts.seriesId)}">Loop<em>lab</em></a>
    <span class="season-pill num">${opts.season ?? "—"} Season</span>
  </header>
  <nav class="series-switch seg">${seriesSwitch}</nav>
  <main class="screen">
<h1 class="sr-only">${esc(opts.title)}</h1>
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
    content: `<div class="card"><div class="card-h"><h2>404</h2></div><p class="note">${esc(what)} not found.</p><p class="note" style="margin-top:8px"><a href="${withSeries("/", seriesId)}">← Back home</a></p></div>`,
  });
}

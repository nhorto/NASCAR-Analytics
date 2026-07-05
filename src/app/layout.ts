import { esc, withSeries } from "./html.ts";

/** Origin of the live-companion Worker (Phase 2/3). The static site fetches its
 *  /api/live cross-origin (CORS is open on the Worker). */
export const LIVE_API_BASE = "https://looplab-live.nhorton.workers.dev";

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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(opts.title)} · Looplab</title>
<link rel="stylesheet" href="/style.css">
<script>window.__LIVE_API__=${JSON.stringify(LIVE_API_BASE)};window.__SERIES__=${opts.seriesId};</script>
</head>
<body>
<div class="shell">
  <header class="appbar">
    <a class="wordmark" href="${withSeries("/", opts.seriesId)}">Loop<em>lab</em></a>
    <span class="season-pill num">${opts.season ?? "—"} Season</span>
  </header>
  <nav class="series-switch seg">${seriesSwitch}</nav>
  <main class="screen">
${opts.content}
  </main>
  <nav class="tabbar">${tabs}</nav>
</div>
<script>
(function(){try{var a=window.__LIVE_API__,s=window.__SERIES__||1;if(!a)return;
fetch(a+"/api/live/status?series="+s,{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){
if(d&&d.live){var el=document.querySelector(".tabbar .tab-live .livedot");if(el)el.hidden=false;}}).catch(function(){});}catch(e){}})();
</script>
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

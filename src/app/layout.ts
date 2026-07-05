import { esc, withSeries } from "./html.ts";

export type Tab = "home" | "metrics" | "drivers" | "races" | "compare" | "tracks";

const TABS: Array<{ id: Tab; href: string; icon: string; label: string }> = [
  { id: "home", href: "/", icon: "⌂", label: "Home" },
  { id: "metrics", href: "/metrics", icon: "◈", label: "Metrics" },
  { id: "drivers", href: "/drivers", icon: "◔", label: "Drivers" },
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
  const tabs = TABS.map(
    (t) =>
      `<a href="${withSeries(t.href, opts.seriesId)}" class="${t.id === opts.active ? "on" : ""}"><span>${t.icon}</span>${t.label}</a>`,
  ).join("");
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

import { esc } from "./html.ts";

export type Tab = "home" | "drivers" | "races" | "compare" | "tracks";

const TABS: Array<{ id: Tab; href: string; icon: string; label: string }> = [
  { id: "home", href: "/", icon: "⌂", label: "Home" },
  { id: "drivers", href: "/drivers", icon: "◔", label: "Drivers" },
  { id: "races", href: "/races", icon: "⚑", label: "Races" },
  { id: "compare", href: "/compare", icon: "⇄", label: "Compare" },
  { id: "tracks", href: "/tracks", icon: "◎", label: "Tracks" },
];

export function page(opts: {
  title: string;
  active: Tab;
  season: number | null;
  content: string;
}): string {
  const tabs = TABS.map(
    (t) =>
      `<a href="${t.href}" class="${t.id === opts.active ? "on" : ""}"><span>${t.icon}</span>${t.label}</a>`,
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
    <a class="wordmark" href="/">Loop<em>lab</em></a>
    <span class="season-pill num">${opts.season ?? "—"} · Cup Series</span>
  </header>
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

export function notFoundPage(season: number | null, what: string): string {
  return page({
    title: "Not found",
    active: "home",
    season,
    content: `<div class="card"><div class="card-h"><h3>404</h3></div><p class="note">${esc(what)} not found.</p><p class="note" style="margin-top:8px"><a href="/">← Back home</a></p></div>`,
  });
}

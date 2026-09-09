// /stats hub (2026-09-09 UX realignment): the mobile Stats tab's landing page.
// The five-tab mobile bar condenses the old eight tabs, so every demoted
// section stays one tap away here. Desktop reaches these directly from the
// sidenav; this page is still routable there, just not linked.
import { navIcon, withSeries } from "../html.ts";

const SECTIONS: Array<{ href: string; icon: string; title: string; sub: string }> = [
  { href: "/recap", icon: "recap", title: "Weekend recap", sub: "Result, loop-data standouts, playoff picture" },
  { href: "/races", icon: "races", title: "Races", sub: "Every race and result, season by season" },
  { href: "/drivers", icon: "drivers", title: "Drivers", sub: "Profiles, race logs, careers" },
  { href: "/metrics", icon: "metrics", title: "Metric leaderboards", sub: "Adjusted pass efficiency · Closer score" },
  { href: "/compare", icon: "compare", title: "Compare drivers", sub: "Head to head — up to four with Pro" },
  { href: "/tracks", icon: "tracks", title: "Track types", sub: "Who is genuinely good on this kind of track" },
];

export function statsHubContent(seriesId: number): string {
  return SECTIONS.map(
    (s) =>
      `<a class="hubrow" href="${withSeries(s.href, seriesId)}">${navIcon(s.icon)}<span class="tx"><b>${s.title}</b><span class="sub">${s.sub}</span></span><span class="chev">›</span></a>`,
  ).join("\n");
}

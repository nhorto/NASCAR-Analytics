import type { DriverCareer, CareerSeriesSummary } from "../../domains/drivers/types.ts";
import { esc, fmt, badge, card, statChips, withSeries } from "../html.ts";
import { SERIES_TABS } from "../layout.ts";

function seriesShort(seriesId: number): string {
  return SERIES_TABS.find((s) => s.id === seriesId)?.short ?? `Series ${seriesId}`;
}

/** Per-series totals table, each series linking to its deep profile. */
function bySeriesCard(career: DriverCareer): string {
  const rows = career.series
    .map(
      (s: CareerSeriesSummary) =>
        `<tr><td><a href="${withSeries(`/drivers/${career.driverId}`, s.seriesId)}">${esc(seriesShort(s.seriesId))}</a></td>` +
        `<td class="r mut">${s.firstSeason}–${s.lastSeason}</td>` +
        `<td class="r">${s.races}</td>` +
        `<td class="r">${s.wins > 0 ? `<b>${s.wins}</b>` : `<span class="mut">0</span>`}</td>` +
        `<td class="r">${s.top5s}</td>` +
        `<td class="r">${fmt(s.avgFinish)}</td></tr>`,
    )
    .join("");
  return card(
    "By Series",
    `<table><tr><th>Series</th><th class="r">Seasons</th><th class="r">Starts</th><th class="r">W</th><th class="r">T5</th><th class="r">Avg Fin</th></tr>${rows}</table>`,
  );
}

/** Season × series matrix — the cross-series timeline. Cell = starts (+ wins). */
function timelineCard(career: DriverCareer): string {
  const seriesIds = career.series.map((s) => s.seriesId);
  const byKey = new Map(career.seasons.map((r) => [`${r.season}|${r.seriesId}`, r]));
  const seasonsDesc = [...new Set(career.seasons.map((r) => r.season))].sort((a, b) => b - a);

  const head = `<tr><th>Yr</th>${seriesIds
    .map((id) => `<th class="r">${esc(seriesShort(id))}</th>`)
    .join("")}</tr>`;
  const body = seasonsDesc
    .map((season) => {
      const cells = seriesIds
        .map((id) => {
          const row = byKey.get(`${season}|${id}`);
          if (!row) return `<td class="r mut">·</td>`;
          const wins = row.wins > 0 ? ` <span class="pos">${row.wins}W</span>` : "";
          return `<td class="r">${row.races}${wins}</td>`;
        })
        .join("");
      return `<tr><td class="mut">${season}</td>${cells}</tr>`;
    })
    .join("");
  return card(
    "Career Timeline",
    `<p class="note" style="margin:-2px 0 8px">Starts per season in each series — wins in green.</p>
     <table>${head}${body}</table>`,
  );
}

export function careerContent(career: DriverCareer): string {
  const parts: string[] = [];

  const totals = career.series.reduce(
    (a, s) => ({
      races: a.races + s.races,
      wins: a.wins + s.wins,
      top5s: a.top5s + s.top5s,
      top10s: a.top10s + s.top10s,
    }),
    { races: 0, wins: 0, top5s: 0, top10s: 0 },
  );

  parts.push(`<div class="drow" style="padding:2px 4px;">
    ${badge(career.latestCarNumber, career.latestTeam, 44)}
    <div>
      <div class="h-title" style="font-size:26px;">${esc(career.fullName)}</div>
      <div class="h-sub">Career · ${career.firstSeason}–${career.lastSeason} · ${career.series.length} series${career.latestTeam ? ` · ${esc(career.latestTeam)}` : ""}</div>
    </div>
  </div>`);

  parts.push(
    statChips([
      { label: "Starts", value: String(totals.races) },
      { label: "Wins", value: String(totals.wins) },
      { label: "Top 5s", value: String(totals.top5s) },
      { label: "Top 10s", value: String(totals.top10s) },
    ]),
  );

  parts.push(bySeriesCard(career));
  parts.push(timelineCard(career));

  return parts.join("\n");
}

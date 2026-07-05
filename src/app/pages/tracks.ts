import type { TrackTypeLeaderRow } from "../../domains/analytics/types.ts";
import { esc, fmt, signed, card, withSeries } from "../html.ts";

const SEGMENTS: Array<{ type: string; label: string }> = [
  { type: "superspeedway", label: "Super" },
  { type: "intermediate", label: "Interm" },
  { type: "short", label: "Short" },
  { type: "road", label: "Road" },
  { type: "dirt", label: "Dirt" },
];

export type TrackSort = "avgFinish" | "avgRating" | "adjPassEfficiency" | "closerScore";

const SORTS: Array<{ key: TrackSort; label: string }> = [
  { key: "avgFinish", label: "Avg Finish" },
  { key: "avgRating", label: "Rating" },
  { key: "adjPassEfficiency", label: "Adj Pass Eff" },
  { key: "closerScore", label: "Closer" },
];

const MIN_STARTS_OPTIONS = [3, 5, 8, 10];

export function tracksContent(data: {
  seriesId: number;
  seasons: number[];
  leaders: TrackTypeLeaderRow[];
  trackType: string;
  fromSeason: number;
  toSeason: number;
  minStarts: number;
  sort: TrackSort;
}): string {
  const parts: string[] = [];
  const sid = data.seriesId;

  // One href builder so every link carries the full filter state; vary one param.
  const href = (over: { type?: string; from?: number; min?: number; sort?: TrackSort }) =>
    withSeries(
      `/tracks?type=${over.type ?? data.trackType}&from=${over.from ?? data.fromSeason}&min=${over.min ?? data.minStarts}&sort=${over.sort ?? data.sort}`,
      sid,
    );

  const seg = SEGMENTS.map(
    (s) =>
      `<a href="${href({ type: s.type })}" class="${s.type === data.trackType ? "on" : ""}">${s.label}</a>`,
  ).join("");
  parts.push(`<div class="seg seg-tracks">${seg}</div>`);

  const sortLinks = SORTS.map((s) =>
    s.key === data.sort
      ? `<b style="color:var(--accent)">${s.label}</b>`
      : `<a href="${href({ sort: s.key })}">${s.label}</a>`,
  ).join(" · ");

  // On-screen filters: since-year + min-starts. Hidden fields keep type/sort/series
  // through the GET submit; auto-submit on change.
  const seriesField = sid === 1 ? "" : `<input type="hidden" name="series" value="${sid}">`;
  const yearOptions = data.seasons
    .filter((y) => y <= data.toSeason)
    .map((y) => `<option value="${y}" ${y === data.fromSeason ? "selected" : ""}>${y}</option>`)
    .join("");
  const minOptions = MIN_STARTS_OPTIONS.map(
    (m) => `<option value="${m}" ${m === data.minStarts ? "selected" : ""}>${m}</option>`,
  ).join("");
  parts.push(`<form class="inline filters" method="get" action="/tracks">
    ${seriesField}
    <input type="hidden" name="type" value="${esc(data.trackType)}">
    <input type="hidden" name="sort" value="${esc(data.sort)}">
    <label class="note" for="from">Since</label>
    <select id="from" name="from" onchange="this.form.submit()">${yearOptions}</select>
    <label class="note" for="min">Min starts</label>
    <select id="min" name="min" onchange="this.form.submit()">${minOptions}</select>
    <noscript><button type="submit">Apply</button></noscript>
  </form>`);
  parts.push(
    `<div class="filter-row"><span class="note num">${data.fromSeason}–${data.toSeason} · points races</span><span class="note">${sortLinks}</span></div>`,
  );

  const sorted = [...data.leaders].sort((a, b) => {
    const va = a[data.sort];
    const vb = b[data.sort];
    if (va === null) return 1;
    if (vb === null) return -1;
    return data.sort === "avgFinish" ? va - vb : vb - va;
  });

  if (sorted.length === 0) {
    parts.push(card("No data", `<p class="note">No drivers meet the filters for this track type.</p>`));
    return parts.join("\n");
  }

  const rows = sorted
    .slice(0, 25)
    .map((l, i) => {
      const metric =
        data.sort === "avgFinish"
          ? fmt(l.avgFinish)
          : data.sort === "avgRating"
            ? fmt(l.avgRating)
            : signed(l[data.sort], data.sort === "closerScore" ? 2 : 1);
      return `<tr><td class="mut">${i + 1}</td><td><a href="${withSeries(`/drivers/${l.driverId}`, sid)}">${esc(l.fullName)}</a></td><td class="r">${l.starts}</td><td class="r">${l.wins > 0 ? `<b class="pos">${l.wins}</b>` : `<span class="mut">0</span>`}</td><td class="r"><b>${metric}</b></td></tr>`;
    })
    .join("");
  const sortLabel = SORTS.find((s) => s.key === data.sort)!.label;
  parts.push(
    card(
      `${SEGMENTS.find((s) => s.type === data.trackType)?.label ?? data.trackType} · ${sortLabel}`,
      `<table><tr><th>#</th><th>Driver</th><th class="r">Starts</th><th class="r">W</th><th class="r">${esc(sortLabel)}</th></tr>${rows}</table>`,
    ),
  );

  parts.push(
    card(
      "About these numbers",
      `<p class="note">Every column comes from official loop data nobody else surfaces by track type. <b>Adj Pass Efficiency</b>: green-flag passing vs the average car at the same running position. <b>Closer</b>: closing-lap position change vs expectation.</p>`,
    ),
  );

  return parts.join("\n");
}

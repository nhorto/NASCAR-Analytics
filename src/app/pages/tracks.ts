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

export function tracksContent(data: {
  seriesId: number;
  leaders: TrackTypeLeaderRow[];
  trackType: string;
  fromSeason: number;
  toSeason: number;
  minStarts: number;
  sort: TrackSort;
}): string {
  const parts: string[] = [];
  const sid = data.seriesId;

  const seg = SEGMENTS.map(
    (s) =>
      `<a href="${withSeries(`/tracks?type=${s.type}&from=${data.fromSeason}&sort=${data.sort}`, sid)}" class="${s.type === data.trackType ? "on" : ""}">${s.label}</a>`,
  ).join("");
  parts.push(`<div class="seg seg-tracks">${seg}</div>`);

  const sortLinks = SORTS.map((s) =>
    s.key === data.sort
      ? `<b style="color:var(--accent)">${s.label}</b>`
      : `<a href="${withSeries(`/tracks?type=${data.trackType}&from=${data.fromSeason}&sort=${s.key}`, sid)}">${s.label}</a>`,
  ).join(" · ");
  parts.push(
    `<div class="filter-row"><span class="note num">${data.fromSeason}–${data.toSeason} · points races · min ${data.minStarts} starts</span><span class="note">${sortLinks}</span></div>`,
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

import type { DriverSummary } from "../../domains/drivers/types.ts";
import type { DriverSeasonStats } from "../../domains/analytics/types.ts";
import { esc, fmt, signed, pct, badge, card } from "../html.ts";

interface Metric {
  label: string;
  value: (s: DriverSeasonStats) => number | null;
  display: (s: DriverSeasonStats) => string;
  lowerIsBetter?: boolean;
}

const METRICS: Metric[] = [
  { label: "Avg Finish", value: (s) => s.avgFinish, display: (s) => fmt(s.avgFinish), lowerIsBetter: true },
  { label: "Avg Start", value: (s) => s.avgStart, display: (s) => fmt(s.avgStart), lowerIsBetter: true },
  { label: "Rating", value: (s) => s.avgRating, display: (s) => fmt(s.avgRating) },
  { label: "Adj Pass Eff", value: (s) => s.adjPassEfficiency, display: (s) => signed(s.adjPassEfficiency) },
  { label: "Closer", value: (s) => s.closerScore, display: (s) => signed(s.closerScore, 2) },
  { label: "Top-15 Laps", value: (s) => s.top15LapPct, display: (s) => pct(s.top15LapPct) },
  { label: "Laps Led", value: (s) => s.lapsLed, display: (s) => String(s.lapsLed) },
  { label: "Wins", value: (s) => s.wins, display: (s) => String(s.wins) },
  { label: "Points", value: (s) => s.points, display: (s) => String(s.points) },
];

function cmpRow(m: Metric, a: DriverSeasonStats, b: DriverSeasonStats): string {
  const va = m.value(a);
  const vb = m.value(b);
  let aWins = false;
  let bWins = false;
  let wa = 50;
  let wb = 50;
  if (va !== null && vb !== null && va !== vb) {
    aWins = m.lowerIsBetter ? va < vb : va > vb;
    bWins = !aWins;
    // Bar length ∝ share of the pair's combined magnitude (shifted for negatives).
    const base = Math.min(va, vb, 0);
    const ma = va - base;
    const mb = vb - base;
    const total = ma + mb || 1;
    let shareA = ma / total;
    if (m.lowerIsBetter) shareA = 1 - shareA;
    wa = Math.round(24 + shareA * 64);
    wb = Math.round(24 + (1 - shareA) * 64);
  }
  return `<div class="cmp-row">
    <span class="v l num">${m.display(a)}</span>
    <span class="cmp-bar l"><i class="${aWins ? "win" : ""}" style="width:${wa}%"></i></span>
    <span class="m">${esc(m.label)}</span>
    <span class="cmp-bar r2"><i class="${bWins ? "win" : ""}" style="width:${wb}%"></i></span>
    <span class="v r2 num">${m.display(b)}</span>
  </div>`;
}

export function compareContent(data: {
  drivers: DriverSummary[];
  a: DriverSummary | null;
  b: DriverSummary | null;
  aStats: DriverSeasonStats | null;
  bStats: DriverSeasonStats | null;
  season: number | null;
  seasons: number[];
}): string {
  const parts: string[] = [];

  const options = (selected: number | null) =>
    data.drivers
      .map(
        (d) =>
          `<option value="${d.driverId}" ${d.driverId === selected ? "selected" : ""}>${esc(d.fullName)}</option>`,
      )
      .join("");
  const seasonOptions = data.seasons
    .map((s) => `<option value="${s}" ${s === data.season ? "selected" : ""}>${s}</option>`)
    .join("");
  parts.push(`<form class="inline" method="get" action="/compare">
    <select name="a" style="flex:1"><option value="">Driver A…</option>${options(data.a?.driverId ?? null)}</select>
    <select name="b" style="flex:1"><option value="">Driver B…</option>${options(data.b?.driverId ?? null)}</select>
    <select name="season">${seasonOptions}</select>
    <button type="submit">Compare</button>
  </form>`);

  if (data.a && data.b) {
    parts.push(`<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 4px;">
      <div class="drow">${badge(data.a.latestCarNumber, data.a.latestTeam)}<div><div class="nm">${esc(data.a.fullName)}</div><div class="sub">${esc(data.a.latestTeam ?? "")}</div></div></div>
      <span style="font-family:var(--display);color:var(--muted);font-size:15px;">VS</span>
      <div class="drow" style="flex-direction:row-reverse;text-align:right;">${badge(data.b.latestCarNumber, data.b.latestTeam)}<div><div class="nm">${esc(data.b.fullName)}</div><div class="sub">${esc(data.b.latestTeam ?? "")}</div></div></div>
    </div>`);

    if (data.aStats && data.bStats) {
      const rows = METRICS.map((m) => cmpRow(m, data.aStats!, data.bStats!)).join("");
      parts.push(card(`${data.season} Season`, rows));
    } else {
      const missing = [
        !data.aStats ? data.a.fullName : null,
        !data.bStats ? data.b.fullName : null,
      ]
        .filter(Boolean)
        .join(" and ");
      parts.push(
        card("No data", `<p class="note">${esc(missing)} did not run points races in ${data.season}.</p>`),
      );
    }
  } else {
    parts.push(
      card(
        "Head-to-Head",
        `<p class="note">Pick two drivers and a season to compare raw pace, loop data, and the proprietary metrics side by side.</p>`,
      ),
    );
  }

  return parts.join("\n");
}

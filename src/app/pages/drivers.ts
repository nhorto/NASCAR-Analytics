import type { DriverSummary, DriverRaceLogEntry } from "../../domains/drivers/types.ts";
import type {
  DriverSeasonStats,
  DriverTrackTypeStats,
  DriverFormRow,
  MetricRank,
} from "../../domains/analytics/types.ts";
import {
  esc,
  fmt,
  signed,
  badge,
  card,
  statChips,
  barRow,
  sparkline,
  deltaArrow,
  fmtDate,
  ordinal,
  withSeries,
  TRACK_TYPE_LABELS,
} from "../html.ts";

export function driversIndexContent(
  drivers: DriverSummary[],
  q: string | null,
  seriesId: number,
): string {
  const filtered = q
    ? drivers.filter((d) => d.fullName.toLowerCase().includes(q.toLowerCase()))
    : drivers;
  const rows = filtered
    .map(
      (d) =>
        `<tr><td><a href="${withSeries(`/drivers/${d.driverId}`, seriesId)}">${esc(d.fullName)}</a></td><td class="r mut">${d.firstSeason}–${d.lastSeason}</td><td class="r">${d.races}</td><td class="r">${d.wins > 0 ? `<b>${d.wins}</b>` : `<span class="mut">0</span>`}</td></tr>`,
    )
    .join("");
  const search = `<form class="inline" method="get" action="${withSeries("/drivers", seriesId)}">
    <input type="search" name="q" placeholder="Search drivers…" value="${esc(q ?? "")}" style="flex:1">
    <button type="submit">Search</button>
  </form>`;
  const table =
    filtered.length > 0
      ? `<table><tr><th>Driver</th><th class="r">Seasons</th><th class="r">Starts</th><th class="r">Wins</th></tr>${rows}</table>`
      : `<p class="note">No drivers match “${esc(q ?? "")}”.</p>`;
  return `${search}\n${card(`Drivers · ${filtered.length}`, table)}`;
}

export function driverProfileContent(data: {
  seriesId: number;
  driver: DriverSummary;
  seasons: DriverSeasonStats[];
  splits: DriverTrackTypeStats[];
  form: DriverFormRow[];
  raceLog: DriverRaceLogEntry[];
  metricRanks: { adjPass: MetricRank | null; closer: MetricRank | null };
}): string {
  const d = data.driver;
  const latest = data.seasons[data.seasons.length - 1] ?? null;
  const parts: string[] = [];

  parts.push(`<div class="drow" style="padding:2px 4px;">
    ${badge(d.latestCarNumber, d.latestTeam, 44)}
    <div>
      <div class="h-title" style="font-size:26px;">${esc(d.fullName)}</div>
      <div class="h-sub">${esc(d.latestTeam ?? "")}${d.latestCarMake ? ` · ${esc(d.latestCarMake)}` : ""} · ${d.firstSeason}–${d.lastSeason} · ${d.races} starts · ${d.wins} wins</div>
    </div>
  </div>`);

  if (latest) {
    parts.push(
      statChips([
        { label: "Avg Fin", value: fmt(latest.avgFinish) },
        { label: "Rating", value: fmt(latest.avgRating) },
        { label: "Top 5s", value: String(latest.top5s) },
        { label: "Laps Led", value: String(latest.lapsLed) },
      ]),
    );
  }

  const ratings = data.form
    .slice(-8)
    .map((f) => f.avgRating)
    .filter((r): r is number => r !== null);
  if (ratings.length >= 2) {
    const lastForm = data.form[data.form.length - 1]!;
    const trendUp = ratings[ratings.length - 1]! >= ratings[0]!;
    parts.push(
      card(
        "Form · Rating, Last 8",
        `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;"><span class="trend ${trendUp ? "up" : "dn"}">${trendUp ? "▲" : "▼"} ${fmt(lastForm.avgFinish)} avg fin L${lastForm.windowRaces}</span></div>
         ${sparkline(ratings)}`,
      ),
    );
  }

  const splitOrder = ["short", "road", "intermediate", "superspeedway", "dirt"];
  const latestSeasonSplits = latest
    ? data.splits.filter((s) => s.season === latest.season && s.races > 0)
    : [];
  if (latestSeasonSplits.length > 0) {
    const worst = Math.max(...latestSeasonSplits.map((s) => s.avgFinish ?? 0), 1);
    const best = Math.min(...latestSeasonSplits.map((s) => s.avgFinish ?? 40));
    const rows = latestSeasonSplits
      .sort((a, b) => splitOrder.indexOf(a.trackType) - splitOrder.indexOf(b.trackType))
      .map((s) => {
        const af = s.avgFinish ?? 0;
        // Lower avg finish = longer, greener bar.
        const width = 100 - ((af - 1) / Math.max(worst, 30)) * 90;
        const tone = af === best ? "good" : af === worst && worst > 20 ? "bad" : undefined;
        return barRow(TRACK_TYPE_LABELS[s.trackType] ?? s.trackType, width, fmt(s.avgFinish), tone);
      })
      .join("");
    parts.push(card(`Track Types · ${latest!.season} Avg Finish`, rows));
  }

  if (latest && latest.loopRaces > 0) {
    const rankLine = (r: MetricRank | null): string =>
      r
        ? `<div class="trend ${r.percentile >= 50 ? "up" : "dn"}" style="margin:3px 0 5px">${ordinal(r.rank)} of ${r.field} · ${r.percentile}th pctl</div>`
        : "";
    const bigMetric = (
      value: number | null,
      digits: number,
      label: string,
      blurb: string,
      rank: MetricRank | null,
    ): string =>
      `<div class="big-metric"><b class="num ${(value ?? 0) >= 0 ? "pos" : "neg"}">${signed(value, digits)}</b>
        ${rankLine(rank)}
        <div class="note"><b>${label}</b> — ${blurb}</div></div>`;
    parts.push(
      card(
        `Loop Metrics · ${latest.season}`,
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${bigMetric(latest.adjPassEfficiency, 1, "Adj Pass Efficiency", "green-flag passing vs the average car running where they run", data.metricRanks.adjPass)}
          ${bigMetric(latest.closerScore, 2, "Closer Score", "positions gained in closing laps vs expectation", data.metricRanks.closer)}
        </div>`,
        { href: withSeries("/metrics", data.seriesId), label: "Leaderboards →" },
      ),
    );
  }

  if (data.seasons.length > 0) {
    const rows = [...data.seasons]
      .reverse()
      .map(
        (s) =>
          `<tr><td>${s.season}</td><td class="r">${s.wins}</td><td class="r">${s.top5s}</td><td class="r">${fmt(s.avgFinish)}</td><td class="r">${fmt(s.avgRating)}</td><td class="r">${s.points}</td></tr>`,
      )
      .join("");
    parts.push(
      card(
        "Seasons",
        `<table><tr><th>Yr</th><th class="r">W</th><th class="r">T5</th><th class="r">Avg Fin</th><th class="r">Rating</th><th class="r">Pts</th></tr>${rows}</table>`,
      ),
    );
  }

  if (data.raceLog.length > 0) {
    const rows = data.raceLog
      .slice(0, 10)
      .map(
        (e) =>
          `<tr><td class="mut">${fmtDate(e.raceDateUtc)}</td><td><a href="/race/${e.raceId}">${esc(e.raceName)}</a></td><td class="r">${deltaArrow(e.start, e.finish)}</td><td class="r"><b>P${e.finish}</b>${e.disqualified ? ` <span class="neg">DQ</span>` : ""}</td></tr>`,
      )
      .join("");
    parts.push(
      card(
        "Recent Races",
        `<table><tr><th>Date</th><th>Race</th><th class="r">Δ</th><th class="r">Fin</th></tr>${rows}</table>`,
      ),
    );
  }

  return parts.join("\n");
}

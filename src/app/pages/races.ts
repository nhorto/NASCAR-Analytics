import type {
  RaceDetails,
  RaceResultWithLoop,
  SeasonRaceListItem,
} from "../../domains/data-ingestion/types.ts";
import {
  esc,
  fmt,
  badge,
  card,
  statChips,
  barRow,
  deltaArrow,
  fmtDate,
  withSeries,
  TRACK_TYPE_LABELS,
} from "../html.ts";

export function racesIndexContent(
  races: SeasonRaceListItem[],
  season: number,
  seasons: number[],
  seriesId: number,
): string {
  // Each season is its own path (/races/{year}); the select navigates there.
  const base = withSeries("/races", seriesId);
  const options = seasons
    .map(
      (s) =>
        `<option value="${s === season ? "" : `${base}/${s}`}" ${s === season ? "selected" : ""}>${s}</option>`,
    )
    .join("");
  const picker = `<form class="inline">
    <label class="note" for="season">Season</label>
    <select id="season" onchange="if(this.value)location.href=this.value">${options}</select>
  </form>`;
  const rows = races
    .map((r) => {
      const name = r.hasResults
        ? `<a href="/race/${r.raceId}">${esc(r.raceName)}</a>`
        : `<span class="mut">${esc(r.raceName)}</span>`;
      return `<tr><td class="mut">${fmtDate(r.raceDateUtc)}</td><td>${name}</td><td class="r mut">${esc(TRACK_TYPE_LABELS[r.trackType] ?? r.trackType)}</td><td class="r">${r.winnerName ? esc(r.winnerName) : "<span class='mut'>—</span>"}</td></tr>`;
    })
    .join("");
  return `${picker}\n${card(
    `${season} Season · ${races.length} events`,
    `<table><tr><th>Date</th><th>Race</th><th class="r">Track</th><th class="r">Winner</th></tr>${rows}</table>`,
  )}`;
}

export function racePageContent(
  race: RaceDetails,
  results: RaceResultWithLoop[],
  seriesId: number,
): string {
  const parts: string[] = [];
  parts.push(`<div>
    <div class="h-title">${esc(race.raceName)}</div>
    <div class="h-sub">${esc(TRACK_TYPE_LABELS[race.trackType] ?? race.trackType)} · ${fmtDate(race.raceDateUtc)}</div>
  </div>`);

  parts.push(
    statChips([
      { label: "Laps", value: race.actualLaps !== null ? String(race.actualLaps) : "—" },
      { label: "Cautions", value: race.cautions !== null ? String(race.cautions) : "—" },
      { label: "Lead Chg", value: race.leadChanges !== null ? String(race.leadChanges) : "—" },
      { label: "MoV (s)", value: race.marginOfVictory ? esc(race.marginOfVictory) : "—" },
    ]),
  );

  const winner = results.find((r) => r.finish === 1);
  if (winner) {
    parts.push(`<div class="hero">
      ${badge(winner.carNumber, winner.teamName, 40)}
      <div>
        <div class="big"><a href="${withSeries(`/drivers/${winner.driverId}`, seriesId)}">${esc(winner.fullName)}</a></div>
        <div class="meta">${winner.start !== null ? `P${winner.start} → P1 · ` : ""}led ${winner.lapsLed} laps${winner.fastLaps ? ` · ${winner.fastLaps} fast laps` : ""}</div>
      </div>
      ${winner.rating !== null ? `<div class="rating"><b class="num">${fmt(winner.rating)}</b><span>Rating</span></div>` : ""}
    </div>`);
  }

  if (results.length > 0) {
    const rows = results
      .map(
        (r) =>
          `<tr><td><b>${r.finish}</b>${r.disqualified ? `<span class="neg"> DQ</span>` : ""}</td><td>${deltaArrow(r.start, r.finish)}</td><td><a href="${withSeries(`/drivers/${r.driverId}`, seriesId)}">${esc(r.fullName)}</a></td><td class="r mut">${r.start ?? "—"}</td><td class="r">${fmt(r.rating)}</td></tr>`,
      )
      .join("");
    parts.push(
      card(
        `Results · ${results.length} cars`,
        `<table><tr><th>Fin</th><th></th><th>Driver</th><th class="r">Start</th><th class="r">Rating</th></tr>${rows}</table>`,
      ),
    );
  } else {
    parts.push(card("Results", `<p class="note">No official results available for this event.</p>`));
  }

  // Loop insights: superlatives worth calling out, from loop data.
  const withLoop = results.filter((r) => r.rating !== null);
  if (withLoop.length > 0) {
    const insights: string[] = [];
    const mostPasses = [...withLoop].sort((a, b) => (b.passesGf ?? 0) - (a.passesGf ?? 0))[0]!;
    if ((mostPasses.passesGf ?? 0) > 0) {
      insights.push(
        barRow("GF Passes", 95, String(mostPasses.passesGf), "acc") +
          `<p class="note" style="margin:-2px 0 8px">${esc(mostPasses.fullName)} made ${mostPasses.passesGf} green-flag passes — most in the race${mostPasses.start !== null ? ` after starting P${mostPasses.start}` : ""}.</p>`,
      );
    }
    const mostFast = [...withLoop].sort((a, b) => (b.fastLaps ?? 0) - (a.fastLaps ?? 0))[0]!;
    if ((mostFast.fastLaps ?? 0) > 0) {
      insights.push(
        barRow("Fast Laps", 80, String(mostFast.fastLaps), "acc") +
          `<p class="note" style="margin:-2px 0 8px">${esc(mostFast.fullName)} owned ${mostFast.fastLaps} of the race's fastest laps.</p>`,
      );
    }
    const bestCloser = [...withLoop].sort(
      (a, b) => (b.closingLapsDiff ?? 0) - (a.closingLapsDiff ?? 0),
    )[0]!;
    if ((bestCloser.closingLapsDiff ?? 0) > 0) {
      insights.push(
        barRow("Late Charge", 60, `+${bestCloser.closingLapsDiff}`, "good") +
          `<p class="note" style="margin:-2px 0">${esc(bestCloser.fullName)} gained ${bestCloser.closingLapsDiff} spots in the closing laps.</p>`,
      );
    }
    if (insights.length > 0) parts.push(card("Loop Insights", insights.join("")));
  }

  return parts.join("\n");
}

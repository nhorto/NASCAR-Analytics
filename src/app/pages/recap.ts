import type { RaceDetails, RaceResultWithLoop } from "../../domains/data-ingestion/types.ts";
import type {
  RaceStandout,
  StandingsMovementRow,
  RaceFormCallouts,
} from "../../domains/analytics/types.ts";
import {
  esc,
  fmt,
  signed,
  badge,
  card,
  statChips,
  fmtDate,
  withSeries,
  TRACK_TYPE_LABELS,
} from "../html.ts";

/** Rank-movement chip: ▲n up, ▼n down, · new, – held. */
function movementChip(row: StandingsMovementRow): string {
  if (row.prevRank === null) return `<span class="acc">NEW</span>`;
  const d = row.rankDelta ?? 0;
  if (d > 0) return `<span class="pos">▲${d}</span>`;
  if (d < 0) return `<span class="neg">▼${-d}</span>`;
  return `<span class="mut">–</span>`;
}

export function recapContent(data: {
  seriesId: number;
  race: RaceDetails;
  results: RaceResultWithLoop[];
  standouts: RaceStandout[];
  movement: StandingsMovementRow[];
  callouts: RaceFormCallouts;
}): string {
  const s = data.seriesId;
  const r = data.race;
  const parts: string[] = [];

  // --- 1. Result summary ---
  parts.push(`<div>
    <div class="note" style="text-transform:uppercase;letter-spacing:.08em">Weekend Recap</div>
    <div class="h-title">${esc(r.raceName)}</div>
    <div class="h-sub">${esc(TRACK_TYPE_LABELS[r.trackType] ?? r.trackType)} · ${fmtDate(r.raceDateUtc)}</div>
  </div>`);

  parts.push(
    statChips([
      { label: "Laps", value: r.actualLaps !== null ? String(r.actualLaps) : "—" },
      { label: "Cautions", value: r.cautions !== null ? String(r.cautions) : "—" },
      { label: "Lead Chg", value: r.leadChanges !== null ? String(r.leadChanges) : "—" },
      { label: "MoV (s)", value: r.marginOfVictory ? esc(r.marginOfVictory) : "—" },
    ]),
  );

  const winner = data.results.find((x) => x.finish === 1);
  const podium = data.results.filter((x) => x.finish <= 3).sort((a, b) => a.finish - b.finish);
  if (winner) {
    const podiumRows = podium
      .map(
        (p) =>
          `<tr><td><b>${p.finish}</b></td><td><a href="${withSeries(`/drivers/${p.driverId}`, s)}">${esc(p.fullName)}</a></td><td class="r mut">${p.start !== null ? `P${p.start} start` : ""}</td></tr>`,
      )
      .join("");
    parts.push(
      card(
        "Result",
        `<div class="hero">
          ${badge(winner.carNumber, winner.teamName, 40)}
          <div>
            <div class="big"><a href="${withSeries(`/drivers/${winner.driverId}`, s)}">${esc(winner.fullName)}</a></div>
            <div class="meta">${winner.start !== null ? `P${winner.start} → P1 · ` : ""}led ${winner.lapsLed} of ${r.actualLaps ?? "?"} laps</div>
          </div>
          ${winner.rating !== null ? `<div class="rating"><b class="num">${fmt(winner.rating)}</b><span>Rating</span></div>` : ""}
        </div>
        <table style="margin-top:10px"><tr><th>Fin</th><th>Podium</th><th class="r"></th></tr>${podiumRows}</table>`,
        { href: `/race/${r.raceId}`, label: "Full results →" },
      ),
    );
  }

  // --- 2. Moat-metric storylines ---
  const topPass = data.standouts.find((x) => x.adjPassEfficiency !== null) ?? null;
  const closerRanked = data.standouts
    .filter((x) => x.closerScore !== null)
    .sort((a, b) => (b.closerScore ?? 0) - (a.closerScore ?? 0));
  const topCloser = closerRanked[0] ?? null;
  if (topPass || topCloser) {
    const lines: string[] = [];
    if (topPass && (topPass.adjPassEfficiency ?? 0) > 0) {
      lines.push(
        `<div class="bar-row"><span class="lbl">Adj Pass Eff</span><span class="num val pos"><b>${signed(topPass.adjPassEfficiency, 1)}</b></span></div>
         <p class="note" style="margin:-2px 0 8px"><a href="${withSeries(`/drivers/${topPass.driverId}`, s)}">${esc(topPass.fullName)}</a> won more passing battles than expected for where he ran — the race's best mover under the hood.</p>`,
      );
    }
    if (topCloser && (topCloser.closerScore ?? 0) > 0) {
      lines.push(
        `<div class="bar-row"><span class="lbl">Closer Score</span><span class="num val good"><b>${signed(topCloser.closerScore, 2)}</b></span></div>
         <p class="note" style="margin:-2px 0"><a href="${withSeries(`/drivers/${topCloser.driverId}`, s)}">${esc(topCloser.fullName)}</a> gained the most ground in the closing laps versus what the field averages from that position.</p>`,
      );
    }
    if (lines.length > 0) {
      parts.push(
        card("What the Loop Data Saw", lines.join(""), {
          href: withSeries("/metrics", s),
          label: "Season leaderboards →",
        }),
      );
    }
  }

  // --- 3. Playoff / standings movement ---
  if (data.movement.length > 0) {
    const shown = data.movement.slice(0, Math.min(data.movement.length, 12));
    const rows: string[] = [];
    shown.forEach((row, i) => {
      rows.push(
        `<tr><td class="mut">${row.rank}</td><td>${movementChip(row)}</td><td><a href="${withSeries(`/drivers/${row.driverId}`, s)}">${esc(row.fullName)}</a></td><td class="r mut">+${row.pointsThisRace}</td><td class="r"><b>${row.points}</b></td></tr>`,
      );
      // Playoff cut divider: after the last in-playoff row that has a follower.
      const next = shown[i + 1];
      if (row.inPlayoff && next && !next.inPlayoff) {
        rows.push(
          `<tr><td colspan="5" class="mut" style="text-align:center;font-size:11px;letter-spacing:.05em">— playoff cut line —</td></tr>`,
        );
      }
    });
    parts.push(
      card(
        "Championship Picture",
        `<table><tr><th>#</th><th>Δ</th><th>Driver</th><th class="r">Race</th><th class="r">Pts</th></tr>${rows.join("")}</table>
         <p class="note" style="margin-top:8px">Standings after this race. Cut line is a simplified top-${data.movement.filter((m) => m.inPlayoff).length || "N"} points order, not the full playoff format.</p>`,
      ),
    );
  }

  // --- 4. Driver-level callouts ---
  const { over, under } = data.callouts;
  if (over.length > 0 || under.length > 0) {
    const list = (title: string, items: typeof over, tone: "pos" | "neg") =>
      items.length === 0
        ? ""
        : `<div class="note" style="margin:6px 0 2px;text-transform:uppercase;letter-spacing:.06em">${title}</div>` +
          items
            .map(
              (c) =>
                `<div class="bar-row"><span class="lbl"><a href="${withSeries(`/drivers/${c.driverId}`, s)}">${esc(c.fullName)}</a></span><span class="num val ${tone}"><b>P${c.finish}</b> vs ${fmt(c.formAvgFinish)} form</span></div>`,
            )
            .join("");
    parts.push(
      card(
        "Standouts of the Day",
        list("Overachieved their form", over, "pos") + list("Off their form", under, "neg"),
      ),
    );
  }

  return parts.join("\n");
}

import type { RaceDetails, RaceResultWithLoop } from "../../domains/data-ingestion/types.ts";
import type {
  RaceStandout,
  PlayoffPicture,
  PlayoffPictureRow,
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

/** Short status badge for a playoff-picture row. */
function statusBadge(status: PlayoffPictureRow["status"]): string {
  switch (status) {
    case "in-win":
      return `<span class="pos" title="Locked in on a win">WIN</span>`;
    case "clinched":
      return `<span class="pos" title="Advanced — won this round">▲ IN</span>`;
    case "in-points":
    case "advancing":
      return `<span class="acc">IN</span>`;
    case "bubble":
      return `<span class="mut">BUBBLE</span>`;
    case "below-cut":
      return `<span class="neg">OUT</span>`;
    case "eliminated":
      return `<span class="neg">✕</span>`;
    default:
      return `<span class="mut">–</span>`;
  }
}

/** The phase-aware Playoff Picture card. */
function playoffCard(pic: PlayoffPicture, seriesId: number): string {
  const s = seriesId;
  const isPlayoff = pic.phase === "playoff";
  const ptsHeader = isPlayoff ? "Rnd" : "Pts";
  // Regular season: show the field + the cut line + a couple bubble rows.
  // Playoffs: show all survivors, then eliminated.
  const survivorRows = pic.rows.filter((r) => r.status !== "eliminated");
  const eliminated = pic.rows.filter((r) => r.status === "eliminated");
  const shown = isPlayoff ? survivorRows : survivorRows.slice(0, pic.cutSize + 3);

  const bodyRows: string[] = [];
  shown.forEach((r, i) => {
    const behind =
      r.pointsToCut !== null && r.pointsToCut > 0
        ? ` <span class="mut">(−${r.pointsToCut})</span>`
        : "";
    bodyRows.push(
      `<tr><td class="mut">${i + 1}</td><td><a href="${withSeries(`/drivers/${r.driverId}`, s)}">${esc(r.fullName)}</a>${behind}</td><td class="r">${statusBadge(r.status)}</td><td class="r mut">${r.wins}</td><td class="r mut">${r.playoffPoints}</td><td class="r"><b>${r.points}</b></td></tr>`,
    );
    // Cut-line divider after the last advancing/in row.
    const next = shown[i + 1];
    const inField = r.status === "in-win" || r.status === "in-points" || r.status === "advancing" || r.status === "clinched";
    const nextOut = next && (next.status === "bubble" || next.status === "below-cut" || next.status === "out");
    if (inField && nextOut) {
      bodyRows.push(
        `<tr><td colspan="6" class="mut" style="text-align:center;font-size:11px;letter-spacing:.05em">— cut line: top ${pic.cutSize} advance —</td></tr>`,
      );
    }
  });

  const elimNote =
    eliminated.length > 0
      ? `<p class="note" style="margin-top:8px">Eliminated: ${eliminated
          .map((r) => `<a href="${withSeries(`/drivers/${r.driverId}`, s)}">${esc(r.fullName)}</a>`)
          .join(", ")}.</p>`
      : "";
  const explain = isPlayoff
    ? `<p class="note" style="margin-top:8px">${esc(pic.roundLabel)} standings — round points + carried playoff points; race winners (▲ IN) auto-advance.</p>`
    : `<p class="note" style="margin-top:8px">Win and in: race winners (top 30 in points) are locked; the rest of the field is by points. Playoff points (PP) are the seeding tiebreak.</p>`;

  return card(
    `Playoff Picture${isPlayoff ? ` · ${esc(pic.roundLabel)}` : ""}`,
    `<table><tr><th>#</th><th>Driver</th><th class="r"></th><th class="r">W</th><th class="r">PP</th><th class="r">${ptsHeader}</th></tr>${bodyRows.join("")}</table>${explain}${elimNote}`,
  );
}

export function recapContent(data: {
  seriesId: number;
  race: RaceDetails;
  results: RaceResultWithLoop[];
  standouts: RaceStandout[];
  playoff: PlayoffPicture;
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

  // --- 3. Playoff picture (season-phase-aware) ---
  if (data.playoff.rows.length > 0) {
    parts.push(playoffCard(data.playoff, s));
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

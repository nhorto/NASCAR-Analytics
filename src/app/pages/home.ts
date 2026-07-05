import type { RaceDetails, RaceResultWithLoop } from "../../domains/data-ingestion/types.ts";
import type { SeasonStanding, FormLeader } from "../../domains/analytics/types.ts";
import { esc, fmt, badge, card, fmtDate, TRACK_TYPE_LABELS } from "../html.ts";

export function homeContent(data: {
  latestRace: RaceDetails | null;
  latestResults: RaceResultWithLoop[];
  standings: SeasonStanding[];
  formLeaders: FormLeader[];
}): string {
  const parts: string[] = [];

  if (data.latestRace) {
    const r = data.latestRace;
    const winner = data.latestResults.find((x) => x.finish === 1);
    const winnerHtml = winner
      ? `<div class="hero" style="margin-top:10px;border:none;padding:8px 0 0;background:none;">
          ${badge(winner.carNumber, winner.teamName, 36)}
          <div>
            <div class="big">${esc(winner.fullName)}</div>
            <div class="meta">Won from P${winner.start ?? "?"} · led ${winner.lapsLed} of ${r.actualLaps ?? "?"}${r.marginOfVictory ? ` · MoV ${esc(r.marginOfVictory)}s` : ""}</div>
          </div>
          ${winner.rating !== null ? `<div class="rating"><b class="num">${fmt(winner.rating)}</b><span>Rating</span></div>` : ""}
        </div>`
      : `<p class="note" style="margin-top:8px">Results pending.</p>`;
    parts.push(
      card(
        `Last Race · ${fmtDate(r.raceDateUtc)}`,
        `<div class="h-title">${esc(r.raceName)}</div>
         <div class="h-sub">${esc(TRACK_TYPE_LABELS[r.trackType] ?? r.trackType)}${r.actualLaps ? ` · ${r.actualLaps} laps` : ""}${r.cautions !== null ? ` · ${r.cautions} cautions` : ""}${r.leadChanges !== null ? ` · ${r.leadChanges} lead changes` : ""}</div>
         ${winnerHtml}`,
        { href: `/races/${r.raceId}`, label: "Full breakdown →" },
      ),
    );
  }

  if (data.standings.length > 0) {
    const rows = data.standings
      .map(
        (s, i) =>
          `<tr><td class="mut">${i + 1}</td><td><a href="/drivers/${s.driverId}">${esc(s.fullName)}</a></td><td class="r">${s.wins}</td><td class="r">${fmt(s.avgFinish)}</td><td class="r"><b>${s.points}</b></td></tr>`,
      )
      .join("");
    parts.push(
      card(
        "Championship",
        `<table><tr><th>#</th><th>Driver</th><th class="r">W</th><th class="r">Avg Fin</th><th class="r">Pts</th></tr>${rows}</table>`,
      ),
    );
  }

  if (data.formLeaders.length > 0) {
    const rows = data.formLeaders
      .map(
        (f) =>
          `<tr><td><a href="/drivers/${f.driverId}">${esc(f.fullName)}</a></td><td class="r">${fmt(f.avgFinish)}</td><td class="r">${fmt(f.avgRating)}</td></tr>`,
      )
      .join("");
    parts.push(
      card(
        "In Form · Last 6 Races",
        `<table><tr><th>Driver</th><th class="r">Avg Fin</th><th class="r">Rating</th></tr>${rows}</table>`,
      ),
    );
  }

  if (parts.length === 0) {
    parts.push(
      card(
        "No data yet",
        `<p class="note">Run <code>bun run backfill</code> then <code>bun run compute</code> to load the database.</p>`,
      ),
    );
  }
  return parts.join("\n");
}

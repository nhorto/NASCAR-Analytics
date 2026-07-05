import type { MetricRank, SeasonMetricBoard } from "../../domains/analytics/types.ts";
import { esc, signed, card, withSeries } from "../html.ts";

const BOARD_LIMIT = 12;

/** A ranked leaderboard for one proprietary metric. */
function leaderboard(
  title: string,
  blurb: string,
  rows: MetricRank[],
  seriesId: number,
  digits: number,
): string {
  if (rows.length === 0) {
    return card(title, `<p class="note">Not enough loop data yet this season.</p>`);
  }
  const body = rows
    .slice(0, BOARD_LIMIT)
    .map((m) => {
      const rankCell =
        m.rank === 1
          ? `<td style="color:var(--accent);font-weight:700">1</td>`
          : `<td class="mut">${m.rank}</td>`;
      const valCls = m.value >= 0 ? "pos" : "neg";
      return `<tr>${rankCell}<td><a href="${withSeries(`/drivers/${m.driverId}`, seriesId)}">${esc(m.fullName)}</a></td><td class="r num ${valCls}"><b>${signed(m.value, digits)}</b></td><td class="r mut">${m.loopRaces}</td></tr>`;
    })
    .join("");
  return card(
    title,
    `<p class="note" style="margin:-2px 0 8px">${blurb}</p>
     <table><tr><th>#</th><th>Driver</th><th class="r">Value</th><th class="r">Races</th></tr>${body}</table>`,
  );
}

export function metricsContent(board: SeasonMetricBoard): string {
  const parts: string[] = [];

  parts.push(
    card(
      `Beyond the Box Score · ${board.season}`,
      `<p class="note" style="line-height:1.5">Two metrics you won't find on the timing screen. Both are
        <b>residuals</b> — a driver measured against the average car running in the same part of the field,
        so a mid-pack driver who overachieves isn't buried under the leaders' raw numbers. Ranked over the
        season's ${board.qualified} loop-data regulars.</p>`,
    ),
  );

  parts.push(
    leaderboard(
      "Adjusted Pass Efficiency",
      "Green-flag passes won vs. the average car running where they run. Positive = a genuine passer.",
      board.adjPass,
      board.seriesId,
      1,
    ),
  );

  parts.push(
    leaderboard(
      "Closer Score",
      "Track positions gained over the closing laps vs. expectation. Positive = strong when it counts.",
      board.closer,
      board.seriesId,
      2,
    ),
  );

  return parts.join("\n");
}

// Pro teaser for gated Xfinity/Trucks pages (spec §8): the headline is real,
// the table is decorative sample rows behind a CSS blur (the real rows never
// leave the server for non-Pro viewers), one tap to /pricing.
import { esc, card } from "../html.ts";

export interface TeaserHeadline {
  season: number | null;
  latestRaceName: string | null;
  winnerName: string | null;
}

const SAMPLE_ROWS = [
  ["1", "————— ———", "142.6", "+8"],
  ["2", "——— ———————", "128.1", "+3"],
  ["3", "———— ————", "119.4", "−2"],
  ["4", "—————— ——", "112.8", "+5"],
  ["5", "———— ——————", "104.2", "−1"],
];

export function teaserContent(opts: { seriesLabel: string; headline: TeaserHeadline }): string {
  const { seriesLabel, headline } = opts;
  const headlineBits = [
    headline.season !== null ? `${headline.season} season` : null,
    headline.latestRaceName ? `Latest: ${headline.latestRaceName}` : null,
    headline.winnerName ? `won by ${headline.winnerName}` : null,
  ].filter(Boolean);
  const headlineHtml =
    headlineBits.length > 0
      ? `<p class="note">${esc(headlineBits.join(" · "))}</p>`
      : `<p class="note">Full ${esc(seriesLabel)} coverage — profiles, races, metrics, live.</p>`;

  const blurred = `<div class="teaser-wrap"><table class="teaser-blur" aria-hidden="true"><tbody>
${SAMPLE_ROWS.map(([p, n, r, d]) => `<tr><td class="num">${p}</td><td>${n}</td><td class="num">${r}</td><td class="num">${d}</td></tr>`).join("\n")}
</tbody></table>
<div class="teaser-lock">
  <p><b>${esc(seriesLabel)} is a Pro feature</b></p>
  <p class="note">All three series, predictions, DFS projections, deep tools, push alerts.</p>
  <a class="teaser-cta" href="/pricing">See Pro — $9.99/mo or $69/season</a>
</div></div>`;

  return card(`${seriesLabel} — Pro`, `${headlineHtml}${blurred}`);
}

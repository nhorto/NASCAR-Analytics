// /dfs content (WS-F, spec §8): projections table with a DK/FD toggle and a
// print-view cheat sheet. Pro-only — free viewers get the locked card.
import { esc, card, fmt } from "../html.ts";
import type { DfsProjectionRow, PredictionStage } from "../../domains/predictions/index.ts";

export interface DfsView {
  raceName: string;
  season: number;
  platform: string;
  stage: PredictionStage;
  generatedAt: string;
  rows: DfsProjectionRow[];
}

const PLATFORM_LABELS: Record<string, string> = { dk: "DraftKings", fd: "FanDuel" };

export function dfsContent(view: DfsView): string {
  const toggle = `<div class="seg dfs-toggle">${["dk", "fd"]
    .map(
      (pf) =>
        `<a href="/dfs?scoring=${pf}" class="${pf === view.platform ? "on" : ""}">${PLATFORM_LABELS[pf]}</a>`,
    )
    .join("")}</div>`;
  const stamp = `<p class="note">${esc(view.raceName)} · ${
    view.stage === "saturday" ? "post-qualifying" : "form-based"
  } run · generated ${esc(new Date(view.generatedAt).toUTCString())} ·
<button type="button" class="linkish" data-print>Print cheat sheet</button></p>`;
  const rows = view.rows
    .map(
      (r, i) =>
        `<tr><td class="num">${i + 1}</td><td>${esc(r.fullName)}</td><td class="num">${
          r.projectedStart === null ? "—" : fmt(r.projectedStart, 0)
        }</td><td class="num"><b>${fmt(r.projectedPoints)}</b></td></tr>`,
    )
    .join("\n");
  const table = `<table class="pred-table"><thead><tr><th>#</th><th>Driver</th><th>Start</th><th>Proj ${esc(
    PLATFORM_LABELS[view.platform] ?? view.platform,
  )} pts</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">Projections come from the same simulation as <a href="/predictions">predictions</a>
(expected finish, laps led, fastest laps) scored with the ${esc(PLATFORM_LABELS[view.platform] ?? view.platform)}
rules in <code>config/dfs/</code>. Paste salaries into your own sheet for value — salary import lands post-launch.</p>`;
  return card(`DFS projections — ${PLATFORM_LABELS[view.platform] ?? view.platform}`, `${toggle}${stamp}${table}`);
}

export function dfsEmptyContent(): string {
  return card(
    "DFS projections",
    `<p class="note">No projection run is stored yet — projections publish with each
<a href="/predictions">predictions</a> run (Thursday and Saturday).</p>`,
  );
}

export function dfsLockedContent(): string {
  return card(
    "DFS projections — Pro",
    `<div class="teaser-wrap"><table class="teaser-blur" aria-hidden="true"><tbody>
<tr><td class="num">1</td><td>————— ———</td><td class="num">——.—</td></tr>
<tr><td class="num">2</td><td>——— ———————</td><td class="num">——.—</td></tr>
<tr><td class="num">3</td><td>———— ————</td><td class="num">——.—</td></tr>
<tr><td class="num">4</td><td>—————— ——</td><td class="num">——.—</td></tr>
</tbody></table>
<div class="teaser-lock">
  <p><b>DFS projections are a Pro feature</b></p>
  <p class="note">DraftKings + FanDuel projections and a printable cheat sheet, every race weekend.</p>
  <a class="teaser-cta" href="/pricing">See Pro — $9.99/mo or $69/season</a>
</div></div>`,
  );
}

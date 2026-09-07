// Compare is client-rendered: the shell ships driver/season pickers and a
// container; /compare.js fetches the season-stats JSON and renders the
// head-to-head in the browser. This keeps it static-hostable without
// pre-generating every driver pairing.
//
// WS-G: Pro gets four slots, a season *range*, and cross-series drivers; free
// keeps the original two-driver, single-season, single-series view. The client
// reads `window.__PRO__` and asks only for the payloads that viewer may fetch
// (the series JSON gate would 403 a free viewer's Xfinity/Trucks request).

import { ASSET_VERSION } from "../html.ts";

export function compareShell(seriesId: number, pro = false): string {
  const slots = (pro ? ["a", "b", "c", "d"] : ["a", "b"])
    .map(
      (k) =>
        `<select id="cmp-${k}" data-slot="${k}" style="flex:1"><option value="">Driver ${k.toUpperCase()}…</option></select>`,
    )
    .join("");
  const seasons = pro
    ? `<label class="note">From</label><select id="cmp-season"></select>
    <label class="note">To</label><select id="cmp-season-to"></select>`
    : `<select id="cmp-season"></select>`;
  const upsell = pro
    ? ""
    : `<p class="note"><a href="/pricing">Compare up to four drivers, across series and season ranges — Pro</a></p>`;
  return `<form class="inline cmp-slots" id="cmp-form" autocomplete="off">${slots}</form>
  <form class="inline filters" id="cmp-range" onsubmit="return false">${seasons}</form>
  ${upsell}
  <div id="cmp-out">
    <div class="card"><div class="card-h"><h3>Head-to-Head</h3></div>
    <p class="note">Pick two drivers and a season to compare raw pace, loop data, and the proprietary metrics side by side.</p></div>
  </div>
  <script>window.__SERIES__=${seriesId};window.__PRO__=${pro ? "true" : "false"};</script>
  <script src="/compare.js?v=${ASSET_VERSION}"></script>`;
}

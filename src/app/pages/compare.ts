// Compare is client-rendered: the shell ships a driver/season picker and a
// container; /compare.js fetches the season-stats JSON for the series and
// renders the head-to-head in the browser. This keeps it static-hostable
// without pre-generating every driver pairing.

import { ASSET_VERSION } from "../html.ts";

export function compareShell(seriesId: number): string {
  return `<form class="inline" id="cmp-form" autocomplete="off">
    <select id="cmp-a" style="flex:1"><option value="">Driver A…</option></select>
    <select id="cmp-b" style="flex:1"><option value="">Driver B…</option></select>
    <select id="cmp-season"></select>
  </form>
  <div id="cmp-out">
    <div class="card"><div class="card-h"><h3>Head-to-Head</h3></div>
    <p class="note">Pick two drivers and a season to compare raw pace, loop data, and the proprietary metrics side by side.</p></div>
  </div>
  <script>window.__SERIES__=${seriesId};</script>
  <script src="/compare.js?v=${ASSET_VERSION}"></script>`;
}

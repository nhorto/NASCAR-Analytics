// The track explorer is client-rendered: the shell ships a container and
// /tracks.js fetches the track-type JSON for the series, then builds the
// track-type segments, filters (season range, min-starts), sort links, and the
// leaderboard in the browser. Keeps the filter combinations static-hostable.
//
// WS-G added the full range control (a `to` year, not just "since"), so a
// question like "who was best on road courses 2019–2021" is answerable
// on-screen instead of by hand-editing the URL.

import { ASSET_VERSION } from "../html.ts";

export function tracksShell(): string {
  return `<div id="tracks-app">
    <div class="card"><div class="card-h"><h3>Track Types</h3></div>
    <p class="note">Loading loop-data track-type leaders…</p></div>
  </div>
  <script src="/tracks.js?v=${ASSET_VERSION}"></script>`;
}

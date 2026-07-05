// The track explorer is client-rendered: the shell ships a container and
// /tracks.js fetches the track-type JSON for the series, then builds the
// track-type segments, filters (since-year, min-starts), sort links, and the
// leaderboard in the browser. Keeps the filter combinations static-hostable.

export function tracksShell(seriesId: number): string {
  return `<div id="tracks-app">
    <div class="card"><div class="card-h"><h3>Track Types</h3></div>
    <p class="note">Loading loop-data track-type leaders…</p></div>
  </div>
  <script>window.__SERIES__=${seriesId};</script>
  <script src="/tracks.js"></script>`;
}

// Live race companion — client-rendered shell. The static page ships the sub-tab
// scaffold + mount points; /live.js polls the live Worker's /api/live for the
// current series (window.__LIVE_API__ / window.__SERIES__, set by boot.js from
// the `<html data-*>` attributes) and renders the board, race overview,
// strategy, and my-driver views client-side.
// Kept client-rendered (like compare/tracks) so the site stays static-hostable.

import { ASSET_VERSION } from "../html.ts";

export function liveShell(pro = false): string {
  // Push is a Pro capability (spec §4); the mount only exists for Pro viewers,
  // and push.js fills it in based on what the device actually supports.
  const pushMount = pro ? `<div id="push-mount"></div>` : "";
  return `<div id="live-status"></div>
  <nav class="subtabs" id="live-subtabs" hidden>
    <a class="on" data-tab="board">Board</a>
    <a data-tab="overview">Overview</a>
    <a data-tab="strategy">Strategy</a>
    <a data-tab="mydriver">My Driver</a>
  </nav>
  <div id="live-body"><div class="card"><p class="note">Connecting to the live feed…</p></div></div>
  ${pushMount}
  <p class="live-foot" id="live-foot"></p>
  <script src="/live.js?v=${ASSET_VERSION}"></script>
  ${pro ? `<script src="/push.js?v=${ASSET_VERSION}" defer></script>` : ""}`;
}

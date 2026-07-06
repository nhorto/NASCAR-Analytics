// Home-page LIVE banner. Checks the live Worker for the current series and, only
// when a session is on track, reveals a "🔴 LIVE" banner + a short "While You
// Were Away" digest that links into the Live section.
(function () {
  var API = window.__LIVE_API__ || "";
  var SERIES = window.__SERIES__ || 1;
  var mount = document.getElementById("live-home");
  if (!API || !mount) return;
  var PREFIX = SERIES === 2 ? "/xfinity" : SERIES === 3 ? "/trucks" : "";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  fetch(API + "/api/live?series=" + SERIES, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.live || !d.snapshot) return;
    var s = d.snapshot;
    var sub = [s.trackName, s.lapsInRace ? "Lap " + s.lap + "/" + s.lapsInRace : "", s.stage ? "Stage " + s.stage.num : ""].filter(Boolean).join(" · ");
    var banner = '<a class="livebanner" href="' + PREFIX + '/live"><span class="livechip"><i></i>Live</span>' +
      '<div><div class="h-title" style="font-size:19px">' + esc(s.runName || "Live session") + "</div>" +
      '<div class="note">' + esc(sub) + "</div></div><span class=\"go\">Open ›</span></a>";

    var ICON = { lead_change: "★", position_gain: "▲", position_loss: "▼", pit: "⛽", caution: "⚑", green: "▶", stage_end: "⚑", out: "✕" };
    var alerts = (d.alerts || []).slice(0, 3);
    var wywa = "";
    if (alerts.length) {
      var rows = alerts.map(function (a) {
        return '<div class="alert"><div class="ai">' + (ICON[a.kind] || "•") + '</div><div class="at">' + esc(a.message) + "<time>Lap " + a.atLap + "</time></div></div>";
      }).join("");
      wywa = '<div class="card" style="margin-top:12px"><div class="card-h"><h3>While You Were Away</h3></div>' + rows + "</div>";
    }
    mount.innerHTML = banner + wywa;
  }).catch(function () {});
})();

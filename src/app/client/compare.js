// Client-side head-to-head. Fetches season-stats JSON for the current series
// and renders the comparison, mirroring src/app/pages/compare.ts's old server
// version. Series comes from window.__SERIES__; selection from the URL query.
(function () {
  var series = window.__SERIES__ || 1;
  var out = document.getElementById("cmp-out");
  var selA = document.getElementById("cmp-a");
  var selB = document.getElementById("cmp-b");
  var selS = document.getElementById("cmp-season");

  function fmt(n, d) {
    if (n === null || n === undefined) return "—";
    return Number(n).toFixed(d === undefined ? 1 : d);
  }
  function signed(n, d) {
    if (n === null || n === undefined) return "—";
    var v = Number(n).toFixed(d === undefined ? 1 : d);
    return n > 0 ? "+" + v : v.replace("-", "−");
  }
  function pct(n) {
    return n === null || n === undefined ? "—" : Math.round(n * 100) + "%";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var METRICS = [
    { label: "Avg Finish", get: function (s) { return s.avgFinish; }, disp: function (s) { return fmt(s.avgFinish); }, low: true },
    { label: "Avg Start", get: function (s) { return s.avgStart; }, disp: function (s) { return fmt(s.avgStart); }, low: true },
    { label: "Rating", get: function (s) { return s.avgRating; }, disp: function (s) { return fmt(s.avgRating); } },
    { label: "Adj Pass Eff", get: function (s) { return s.adjPE; }, disp: function (s) { return signed(s.adjPE); } },
    { label: "Closer", get: function (s) { return s.closer; }, disp: function (s) { return signed(s.closer, 2); } },
    { label: "Top-15 Laps", get: function (s) { return s.top15; }, disp: function (s) { return pct(s.top15); } },
    { label: "Laps Led", get: function (s) { return s.lapsLed; }, disp: function (s) { return String(s.lapsLed); } },
    { label: "Wins", get: function (s) { return s.wins; }, disp: function (s) { return String(s.wins); } },
    { label: "Points", get: function (s) { return s.points; }, disp: function (s) { return String(s.points); } },
  ];

  function cmpRow(m, a, b) {
    var va = m.get(a), vb = m.get(b);
    var aWins = false, bWins = false, wa = 50, wb = 50;
    if (va !== null && vb !== null && va !== vb) {
      aWins = m.low ? va < vb : va > vb;
      bWins = !aWins;
      var base = Math.min(va, vb, 0);
      var ma = va - base, mb = vb - base, total = ma + mb || 1;
      var shareA = ma / total;
      if (m.low) shareA = 1 - shareA;
      wa = Math.round(24 + shareA * 64);
      wb = Math.round(24 + (1 - shareA) * 64);
    }
    return '<div class="cmp-row"><span class="v l num">' + m.disp(a) + '</span>' +
      '<span class="cmp-bar l"><i class="' + (aWins ? "win" : "") + '" style="width:' + wa + '%"></i></span>' +
      '<span class="m">' + esc(m.label) + '</span>' +
      '<span class="cmp-bar r2"><i class="' + (bWins ? "win" : "") + '" style="width:' + wb + '%"></i></span>' +
      '<span class="v r2 num">' + m.disp(b) + "</span></div>";
  }

  var DATA = [];
  var byKey = {}; // driverId|season -> row
  var drivers = []; // {id,name}

  function q() { return new URLSearchParams(window.location.search); }

  function render() {
    var a = selA.value, b = selB.value, season = Number(selS.value);
    if (!a || !b) {
      out.innerHTML = '<div class="card"><div class="card-h"><h3>Head-to-Head</h3></div>' +
        '<p class="note">Pick two drivers and a season to compare raw pace, loop data, and the proprietary metrics side by side.</p></div>';
      return;
    }
    var ra = byKey[a + "|" + season], rb = byKey[b + "|" + season];
    var nameA = (drivers.find(function (d) { return String(d.id) === a; }) || {}).name || "A";
    var nameB = (drivers.find(function (d) { return String(d.id) === b; }) || {}).name || "B";
    var head = '<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 4px;">' +
      '<div class="nm">' + esc(nameA) + '</div>' +
      '<span style="font-family:var(--display);color:var(--muted);font-size:15px;">VS</span>' +
      '<div class="nm" style="text-align:right">' + esc(nameB) + "</div></div>";
    if (!ra || !rb) {
      out.innerHTML = head + '<div class="card"><div class="card-h"><h3>No data</h3></div>' +
        '<p class="note">One of these drivers did not run points races in ' + season + ".</p></div>";
      return;
    }
    var rows = METRICS.map(function (m) { return cmpRow(m, ra, rb); }).join("");
    out.innerHTML = head + '<div class="card"><div class="card-h"><h3>' + season + " Season</h3></div>" + rows + "</div>";
  }

  function syncUrl() {
    var p = q();
    if (selA.value) p.set("a", selA.value); else p.delete("a");
    if (selB.value) p.set("b", selB.value); else p.delete("b");
    p.set("season", selS.value);
    history.replaceState(null, "", window.location.pathname + "?" + p.toString());
  }

  function onChange() { syncUrl(); render(); }

  fetch("/data/season-stats-" + series + ".json")
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      DATA = rows;
      var seen = {}, seasons = {};
      rows.forEach(function (r) {
        byKey[r.id + "|" + r.season] = r;
        if (!seen[r.id]) { seen[r.id] = 1; drivers.push({ id: r.id, name: r.name }); }
        seasons[r.season] = 1;
      });
      drivers.sort(function (x, y) { return x.name.localeCompare(y.name); });
      var seasonList = Object.keys(seasons).map(Number).sort(function (a, b) { return b - a; });

      var opts = drivers.map(function (d) {
        return '<option value="' + d.id + '">' + esc(d.name) + "</option>";
      }).join("");
      selA.insertAdjacentHTML("beforeend", opts);
      selB.insertAdjacentHTML("beforeend", opts);
      selS.innerHTML = seasonList.map(function (s) {
        return '<option value="' + s + '">' + s + "</option>";
      }).join("");

      var p = q();
      if (p.get("a")) selA.value = p.get("a");
      if (p.get("b")) selB.value = p.get("b");
      selS.value = p.get("season") && seasons[p.get("season")] ? p.get("season") : String(seasonList[0]);

      selA.addEventListener("change", onChange);
      selB.addEventListener("change", onChange);
      selS.addEventListener("change", onChange);
      render();
    })
    .catch(function () {
      out.innerHTML = '<div class="card"><p class="note">Could not load comparison data.</p></div>';
    });
})();

// Client-side head-to-head. Fetches season-stats JSON and renders the
// comparison. Series comes from window.__SERIES__; selection from the URL query.
//
// WS-G: a Pro viewer gets four slots, a season range, and drivers from every
// series (three payloads); free stays at two drivers, one season, one series.
// Two selections keep the paired bar view; three or four switch to a
// driver-per-column table, which is the only layout that stays readable.
(function () {
  var series = window.__SERIES__ || 1;
  var PRO = window.__PRO__ === true;
  var SLOTS = PRO ? ["a", "b", "c", "d"] : ["a", "b"];
  var SERIES_NAMES = { 1: "Cup", 2: "Xfinity", 3: "Trucks" };
  var out = document.getElementById("cmp-out");
  var sel = {};
  SLOTS.forEach(function (k) { sel[k] = document.getElementById("cmp-" + k); });
  var selFrom = document.getElementById("cmp-season");
  var selTo = document.getElementById("cmp-season-to");

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

  var rowsBySeries = {};   // seriesId -> raw rows
  var drivers = [];        // {key,id,series,name,label}
  var seasonList = [];

  function q() { return new URLSearchParams(window.location.search); }

  /**
   * Fold one driver's seasons in [from,to] into a single comparable row.
   * Counting stats sum; averages weight by races; loop metrics weight by
   * loopRaces — weighting those by races would let a season with no loop data
   * drag the average toward zero.
   */
  function aggregate(key, from, to) {
    var parts = key.split(":");
    var sid = Number(parts[0]), did = Number(parts[1]);
    var rows = (rowsBySeries[sid] || []).filter(function (r) {
      return r.id === did && r.season >= from && r.season <= to;
    });
    if (rows.length === 0) return null;
    var agg = {
      races: 0, wins: 0, top5s: 0, top10s: 0, lapsLed: 0, points: 0,
      finSum: 0, finW: 0, startSum: 0, startW: 0,
      ratSum: 0, adjSum: 0, closSum: 0, t15Sum: 0, loopW: 0,
    };
    rows.forEach(function (r) {
      agg.races += r.races; agg.wins += r.wins; agg.top5s += r.top5s;
      agg.top10s += r.top10s; agg.lapsLed += r.lapsLed; agg.points += r.points;
      if (r.avgFinish !== null && r.avgFinish !== undefined) { agg.finSum += r.avgFinish * r.races; agg.finW += r.races; }
      if (r.avgStart !== null && r.avgStart !== undefined) { agg.startSum += r.avgStart * r.races; agg.startW += r.races; }
      var lw = r.loopRaces || 0;
      if (lw > 0) {
        if (r.avgRating !== null) agg.ratSum += (r.avgRating || 0) * lw;
        if (r.adjPE !== null) agg.adjSum += (r.adjPE || 0) * lw;
        if (r.closer !== null) agg.closSum += (r.closer || 0) * lw;
        if (r.top15 !== null) agg.t15Sum += (r.top15 || 0) * lw;
        agg.loopW += lw;
      }
    });
    return {
      races: agg.races, wins: agg.wins, top5s: agg.top5s, top10s: agg.top10s,
      lapsLed: agg.lapsLed, points: agg.points,
      avgFinish: agg.finW ? agg.finSum / agg.finW : null,
      avgStart: agg.startW ? agg.startSum / agg.startW : null,
      avgRating: agg.loopW ? agg.ratSum / agg.loopW : null,
      adjPE: agg.loopW ? agg.adjSum / agg.loopW : null,
      closer: agg.loopW ? agg.closSum / agg.loopW : null,
      top15: agg.loopW ? agg.t15Sum / agg.loopW : null,
    };
  }

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

  /** Three or four drivers: one column each, best value per metric marked. */
  function cmpTable(picks) {
    var head = '<tr><th>Metric</th>' + picks.map(function (p) {
      return '<th class="r">' + esc(p.name) + "</th>";
    }).join("") + "</tr>";
    var body = METRICS.map(function (m) {
      var values = picks.map(function (p) { return m.get(p.stats); });
      var best = null;
      values.forEach(function (v) {
        if (v === null || v === undefined) return;
        if (best === null) best = v;
        else best = m.low ? Math.min(best, v) : Math.max(best, v);
      });
      var cells = picks.map(function (p, i) {
        var isBest = best !== null && values[i] === best;
        return '<td class="r num">' + (isBest ? "<b>" + m.disp(p.stats) + "</b>" : m.disp(p.stats)) + "</td>";
      }).join("");
      return "<tr><td>" + esc(m.label) + "</td>" + cells + "</tr>";
    }).join("");
    return "<table>" + head + body + "</table>";
  }

  function range() {
    var from = Number(selFrom.value);
    var to = selTo ? Number(selTo.value) : from;
    return to < from ? { from: to, to: from } : { from: from, to: to };
  }

  function exportBar(picks, r) {
    if (!PRO || picks.length === 0) return "";
    var ids = picks.map(function (p) { return p.id; }).join(",");
    var seriesIds = [];
    picks.forEach(function (p) { if (seriesIds.indexOf(p.series) === -1) seriesIds.push(p.series); });
    var href = "/export/compare.csv?series=" + seriesIds.join(",") + "&drivers=" + ids +
      "&from=" + r.from + "&to=" + r.to;
    return '<p class="note export-bar">⭳ Export CSV: <a href="' + href + '" download>Comparison</a></p>';
  }

  function render() {
    var r = range();
    var picks = [];
    SLOTS.forEach(function (k) {
      var key = sel[k].value;
      if (!key) return;
      var meta = drivers.find(function (d) { return d.key === key; });
      var stats = aggregate(key, r.from, r.to);
      picks.push({ key: key, id: Number(key.split(":")[1]), series: Number(key.split(":")[0]),
        name: meta ? meta.name : "?", stats: stats });
    });

    if (picks.length < 2) {
      out.innerHTML = '<div class="card"><div class="card-h"><h2>Head-to-Head</h2></div>' +
        '<p class="note">Pick ' + (PRO ? "two to four drivers" : "two drivers") +
        ' and a season to compare raw pace, loop data, and the proprietary metrics side by side.</p></div>';
      return;
    }
    var missing = picks.filter(function (p) { return p.stats === null; });
    var span = r.from === r.to ? String(r.from) : r.from + "–" + r.to;
    if (missing.length > 0) {
      out.innerHTML = '<div class="card"><div class="card-h"><h2>No data</h2></div>' +
        '<p class="note">' + esc(missing.map(function (p) { return p.name; }).join(", ")) +
        " did not run points races in " + span + ".</p></div>";
      return;
    }

    var body;
    if (picks.length === 2) {
      var head = '<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 4px;">' +
        '<div class="nm">' + esc(picks[0].name) + '</div>' +
        '<span style="font-family:var(--display);color:var(--muted);font-size:15px;">VS</span>' +
        '<div class="nm" style="text-align:right">' + esc(picks[1].name) + "</div></div>";
      var rows = METRICS.map(function (m) { return cmpRow(m, picks[0].stats, picks[1].stats); }).join("");
      body = head + '<div class="card"><div class="card-h"><h2>' + esc(span) + "</h2></div>" + rows + "</div>";
    } else {
      body = '<div class="card"><div class="card-h"><h2>' + esc(span) + "</h2></div>" + cmpTable(picks) + "</div>";
    }
    out.innerHTML = exportBar(picks, r) + body;
  }

  function syncUrl() {
    var p = q();
    SLOTS.forEach(function (k) {
      if (sel[k].value) p.set(k, sel[k].value); else p.delete(k);
    });
    p.set("season", selFrom.value);
    if (selTo) p.set("to", selTo.value);
    history.replaceState(null, "", window.location.pathname + "?" + p.toString());
  }

  function onChange() { syncUrl(); render(); }

  function payloadUrl(s) { return "/data/season-stats-" + s + ".json"; }

  // A free viewer may only read Cup (the series JSON gate 403s the rest), so
  // only a Pro viewer asks for all three.
  var wanted = PRO ? [1, 2, 3] : [series];

  Promise.all(wanted.map(function (s) {
    return fetch(payloadUrl(s))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return { series: s, rows: rows }; })
      .catch(function () { return { series: s, rows: [] }; });
  })).then(function (payloads) {
    var seasons = {};
    payloads.forEach(function (payload) {
      rowsBySeries[payload.series] = payload.rows;
      var seen = {};
      payload.rows.forEach(function (row) {
        seasons[row.season] = 1;
        if (!seen[row.id]) {
          seen[row.id] = 1;
          drivers.push({
            key: payload.series + ":" + row.id,
            id: row.id,
            series: payload.series,
            name: row.name,
            label: PRO && wanted.length > 1 ? row.name + " · " + (SERIES_NAMES[payload.series] || payload.series) : row.name,
          });
        }
      });
    });
    if (drivers.length === 0) {
      out.innerHTML = '<div class="card"><p class="note">No comparison data for this series yet.</p></div>';
      return;
    }
    drivers.sort(function (x, y) { return x.label.localeCompare(y.label); });
    seasonList = Object.keys(seasons).map(Number).sort(function (a, b) { return b - a; });

    var opts = drivers.map(function (d) {
      return '<option value="' + d.key + '">' + esc(d.label) + "</option>";
    }).join("");
    SLOTS.forEach(function (k) { sel[k].insertAdjacentHTML("beforeend", opts); });
    var yearOpts = seasonList.map(function (s) {
      return '<option value="' + s + '">' + s + "</option>";
    }).join("");
    selFrom.innerHTML = yearOpts;
    if (selTo) selTo.innerHTML = yearOpts;

    var p = q();
    // Older links carried a bare driver id (?a=4062); read them as "this series".
    SLOTS.forEach(function (k) {
      var raw = p.get(k);
      if (!raw) return;
      sel[k].value = raw.indexOf(":") === -1 ? series + ":" + raw : raw;
    });
    var wantedSeason = p.get("season");
    selFrom.value = wantedSeason && seasons[wantedSeason] ? wantedSeason : String(seasonList[0]);
    if (selTo) {
      var wantedTo = p.get("to");
      selTo.value = wantedTo && seasons[wantedTo] ? wantedTo : String(seasonList[0]);
    }

    SLOTS.forEach(function (k) { sel[k].addEventListener("change", onChange); });
    selFrom.addEventListener("change", onChange);
    if (selTo) selTo.addEventListener("change", onChange);
    render();
  }).catch(function () {
    out.innerHTML = '<div class="card"><p class="note">Could not load comparison data.</p></div>';
  });
})();

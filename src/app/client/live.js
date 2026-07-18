// Live race companion — client renderer. Polls the live Worker's /api/live for
// the current series and renders the layered board (tap a row to drill down),
// Race Overview, Strategy, and My Driver sub-tabs, plus the idle state. All state
// is client-side (followed driver + alert prefs persist in localStorage).
(function () {
  "use strict";
  var API = window.__LIVE_API__ || "";
  var SERIES = window.__SERIES__ || 1;
  var POLL_MS = 5000;

  var state = {
    tab: "board",
    sort: "pos", // "pos" | "metric"
    followId: localStorage.getItem("looplab_follow") || "",
    openId: null, // expanded board row (driverId)
    data: null,
    lastOkAt: 0,
    rosterSig: "",
  };

  var elStatus = document.getElementById("live-status");
  var elSubtabs = document.getElementById("live-subtabs");
  var elBody = document.getElementById("live-body");
  var elFoot = document.getElementById("live-foot");

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function n1(v) { return v == null ? "—" : Number(v).toFixed(1); }
  function n0(v) { return v == null ? "—" : Number(v).toFixed(0); }
  function pct(v) { return v == null ? "—" : Math.round(v * 100) + "%"; }
  function signed(v, d) {
    if (v == null) return "—";
    var s = Number(v).toFixed(d == null ? 1 : d);
    return v > 0 ? "+" + s : s.replace("-", "−");
  }
  function arrow(v) {
    if (v == null) return '<span class="mut">—</span>';
    if (v === 0) return '<span class="mut">▶0</span>';
    return v > 0 ? '<span class="pos">▲' + v + "</span>" : '<span class="neg">▼' + Math.abs(v) + "</span>";
  }
  function gapOf(d) {
    if (d.position === 1) return "Leader";
    if (d.gapToLeader == null) return "—";
    return "+" + Number(d.gapToLeader).toFixed(2);
  }
  function moverStart(d) { return d.starting == null ? null : d.starting - d.position; }
  function manuColor(m) {
    m = (m || "").toLowerCase();
    if (m.indexOf("chev") >= 0) return "#d39c00";
    if (m.indexOf("ford") >= 0) return "#1c5bd4";
    if (m.indexOf("toyota") >= 0) return "#c8102e";
    return "#3b3f4a";
  }
  function badge(car, manu, size) {
    size = size || 30;
    return '<span class="badge" style="width:' + size + "px;height:" + size + "px;font-size:" +
      (size * 0.5).toFixed(0) + "px;background:" + manuColor(manu) + '">' + esc(car) + "</span>";
  }

  // Field ranks (1 = best) among running cars, per metric where higher is better.
  function computeRanks(drivers) {
    var running = drivers.filter(function (d) { return d.running; });
    function rankMap(get) {
      var withV = running.filter(function (d) { return get(d) != null; })
        .sort(function (a, b) { return get(b) - get(a); });
      var m = {};
      withV.forEach(function (d, i) { m[d.driverId] = i + 1; });
      return m;
    }
    return {
      adjPE: rankMap(function (d) { return d.adjPassEfficiency; }),
      qp: rankMap(function (d) { return d.qualityPasses; }),
      closer: rankMap(function (d) { return d.closerEstimate; }),
      total: running.length,
    };
  }
  function barPct(rank, total) { return total > 0 && rank ? Math.max(8, Math.round((1 - (rank - 1) / total) * 100)) : 0; }

  // Inline sparkline. invert=true → smaller value plots higher (for positions).
  function sparkline(vals, color, invert) {
    var present = vals.filter(function (v) { return v != null; });
    if (present.length < 2) return '<svg class="spark" viewBox="0 0 150 44" width="100%" height="44"><polyline fill="none" stroke="#2a3140" stroke-width="1" points="0,40 150,40"/></svg>';
    var min = Math.min.apply(null, present), max = Math.max.apply(null, present), range = (max - min) || 1;
    var n = vals.length, coords = [];
    for (var i = 0; i < n; i++) {
      var v = vals[i];
      if (v == null) continue;
      var x = (n === 1 ? 0 : (i / (n - 1))) * 146 + 2;
      var norm = (v - min) / range;
      if (invert) norm = 1 - norm;
      var y = 40 - norm * 34;
      coords.push(x.toFixed(0) + "," + y.toFixed(0));
    }
    var last = coords[coords.length - 1].split(",");
    return '<svg class="spark" viewBox="0 0 150 44" width="100%" height="44">' +
      '<polyline fill="none" stroke="#2a3140" stroke-width="1" points="0,40 150,40"/>' +
      '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + coords.join(" ") + '"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="' + color + '"/></svg>';
  }

  function flagInfo(flag) {
    var m = {
      green: { label: "Green", cls: "green" },
      yellow: { label: "Caution", cls: "yellow" },
      red: { label: "Red flag", cls: "red" },
      white: { label: "White flag", cls: "white" },
      checkered: { label: "Checkered", cls: "checkered" },
      hot: { label: "On track", cls: "" },
      cold: { label: "Track cold", cls: "" },
      none: { label: "Standby", cls: "" },
      unknown: { label: "Standby", cls: "" },
    };
    return m[flag] || m.unknown;
  }

  // ---------- status header ----------
  function renderStatus(data) {
    var s = data.snapshot, fi = flagInfo(s.flag);
    if (data.authoritative) fi = { label: "Final · official loop data", cls: "checkered" };
    var stageTxt = s.stage ? ("Stage " + s.stage.num) : "";
    var toGo = s.lapsToGo || (s.lapsInRace && s.lap ? Math.max(0, s.lapsInRace - s.lap) : 0);
    var stale = state.lastOkAt && (Date.now() - state.lastOkAt > 20000);
    var right = s.lapsInRace
      ? '<div class="ftime"><b class="num">' + toGo + "</b><span>Laps to go</span></div>"
      : "";
    var sub = [s.trackName, stageTxt].filter(Boolean).join(" · ");
    var flagbar = '<div class="flagbar ' + fi.cls + '">' +
      '<div class="flag-ico ' + fi.cls + '"></div>' +
      "<div><div class=\"fmain\">" + esc(fi.label) + (s.runName ? " · " + esc(s.runName) : "") + "</div>" +
      '<div class="fsub">' + esc(sub || "") + (stale ? ' <span class="stale-chip">reconnecting…</span>' : "") + "</div></div>" +
      right + "</div>";

    var stagebar = "";
    if (s.stage && s.stage.finishAtLap && s.lapsInRace) {
      var pctStage = Math.max(0, Math.min(100, Math.round((s.lap / s.stage.finishAtLap) * 100)));
      stagebar = '<div class="stagebar" style="margin-top:10px"><span class="lbl">St ' + s.stage.num +
        '</span><div class="track"><i style="width:' + pctStage + '%"></i></div>' +
        '<span class="lbl num">ends L' + s.stage.finishAtLap + "</span></div>";
    }
    elStatus.innerHTML = '<div class="card" style="padding:0;border:none;background:none">' + flagbar + stagebar + "</div>";
  }

  // ---------- board ----------
  function driverRow(d, ranks, followId) {
    var mine = String(d.driverId) === String(followId);
    var seg = (d.segments || []).map(function (x) { return '<i class="' + x + '"></i>'; }).join("");
    if (!seg) seg = '<i></i><i></i><i></i><i></i><i></i>';
    var mv = moverStart(d);
    var mvHtml = mv == null ? '<span class="mv flat">—</span>'
      : (mv > 0 ? '<span class="mv pos">▲' + mv + "</span>"
        : mv < 0 ? '<span class="mv neg">▼' + Math.abs(mv) + "</span>"
          : '<span class="mv flat">▶0</span>');
    var metricCls = d.adjPassEfficiency == null ? "" : (d.adjPassEfficiency >= 0 ? "pos" : "neg");
    var row = '<div class="lb-row' + (d.position === 1 ? " p1" : "") + (mine ? " me" : "") +
      (String(d.driverId) === String(state.openId) ? " open" : "") + '" data-id="' + d.driverId + '">' +
      '<span class="p num">' + d.position + "</span>" + badge(d.carNumber, d.manufacturer, 30) +
      '<div class="who"><div class="nm">' + esc(d.driverName) + '</div><div class="meta"><span>' +
      esc(d.manufacturer || "") + '</span><span class="segbar">' + seg + "</span></div></div>" +
      '<div class="right">' + mvHtml + '<span class="gap num">' + gapOf(d) + "</span>" +
      '<span class="metricval num ' + metricCls + '">' + signed(d.adjPassEfficiency) + "</span>" +
      '<span class="chev">›</span></div></div>';
    var drill = '<div class="drill" data-drill="' + d.driverId + '"' +
      (String(d.driverId) === String(state.openId) ? "" : ' hidden') + ">" + drillHtml(d, ranks) + "</div>";
    return row + drill;
  }

  function drillHtml(d, ranks) {
    var mv = moverStart(d);
    var chips = '<div class="mini-chips">' +
      chip("P" + d.position, "Pos") +
      chip(d.position === 1 ? "—" : (d.gapToLeader == null ? "—" : "+" + Number(d.gapToLeader).toFixed(2)), "To Ldr") +
      chip(mv == null ? "—" : (mv >= 0 ? "▲" + mv : "▼" + Math.abs(mv)), "vs Start") +
      chip(n0(d.lastLapSpeed), "Last mph") + "</div>";

    function metricRow(label, val, rank, good) {
      var rk = rank ? " <small>#" + rank + "</small>" : "";
      var cls = good == null ? "" : (good ? "good" : "bad");
      return '<div class="mrow"><span class="lbl">' + label + '</span><span class="bar"><i class="' + cls +
        '" style="width:' + barPct(rank, ranks.total) + '%"></i></span><span class="val">' + val + rk + "</span></div>";
    }
    var metrics = '<div class="drill-h">Live loop metrics · rank in field</div>' +
      metricRow("Adj Pass Eff", signed(d.adjPassEfficiency), ranks.adjPE[d.driverId], d.adjPassEfficiency == null ? null : d.adjPassEfficiency >= 0) +
      metricRow("Quality Pass", d.qualityPasses == null ? "—" : d.qualityPasses, ranks.qp[d.driverId], true) +
      metricRow("Closer est.", signed(d.closerEstimate), ranks.closer[d.driverId], d.closerEstimate == null ? null : d.closerEstimate >= 0);

    var cyc = pitOf(d.driverId);
    var pitTags = '<div class="drill-h">Pit / strategy</div><div class="pit-line">';
    if (cyc && cyc.lastGreenPitLap != null) {
      pitTags += '<span class="pit-tag">Last stop <b>L' + cyc.lastGreenPitLap + "</b></span>";
      if (cyc.lapsSincePit != null) pitTags += '<span class="pit-tag"><b>' + cyc.lapsSincePit + "</b> laps on tires</span>";
      if (cyc.estimatedNextPitLap != null) {
        var due = cyc.lapsSincePit != null && cyc.stintLength && cyc.lapsSincePit >= cyc.stintLength;
        pitTags += '<span class="pit-tag' + (due ? " warn" : "") + '">' + (due ? "Pit window open" : "Est. pit ~L" + cyc.estimatedNextPitLap) + "</span>";
      }
    } else {
      pitTags += '<span class="pit-tag">No green-flag stop yet</span>';
    }
    pitTags += "</div>";

    var trends = '<div class="drill-h">This race so far</div>';
    if ((d.posTrend || []).length >= 2) {
      trends += '<div style="display:flex;gap:8px">' +
        '<div style="width:50%"><div class="lbl" style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Running pos</div>' + sparkline(d.posTrend, "#34d399", true) + "</div>" +
        '<div style="width:50%"><div class="lbl" style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Lap-speed</div>' + sparkline(d.spdTrend || [], "#ffd23f", false) + "</div></div>";
    } else {
      trends += '<p class="note">Trend builds over the next few green-flag laps.</p>';
    }
    return chips + metrics + pitTags + trends;
  }
  function chip(v, l) { return '<div class="c"><b class="num">' + esc(v) + "</b><span>" + esc(l) + "</span></div>"; }

  function renderBoard(data) {
    var drivers = data.snapshot.drivers.slice();
    var ranks = computeRanks(drivers);
    if (state.sort === "metric") {
      drivers.sort(function (a, b) {
        var av = a.adjPassEfficiency, bv = b.adjPassEfficiency;
        if (av == null && bv == null) return a.position - b.position;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
    }
    var sortSeg = '<nav class="seg" id="sortseg" style="margin-bottom:2px">' +
      '<a data-mode="pos" class="' + (state.sort === "pos" ? "on" : "") + '">Running Order</a>' +
      '<a data-mode="metric" class="' + (state.sort === "metric" ? "on" : "") + '">Loop Rating ★</a></nav>';
    var rows = drivers.map(function (d) { return driverRow(d, ranks, state.followId); }).join("");
    var board = '<div class="card" style="padding:6px 10px"><div class="lb' + (state.sort === "metric" ? " by-metric" : "") + '" id="board">' + rows + "</div></div>";
    return sortSeg + board + '<p class="note" style="text-align:center;margin-top:2px">Tap a car for its full live panel · refreshes every ' + (POLL_MS / 1000) + "s</p>";
  }

  // ---------- overview ----------
  function renderOverview(data) {
    var s = data.snapshot;
    var chips = '<div class="chips">' +
      ovChip(s.lap + (s.lapsInRace ? "/" + s.lapsInRace : ""), "Lap") +
      ovChip(s.cautionSegments || 0, "Cautions") +
      ovChip(s.leadChanges || 0, "Lead Chg") +
      ovChip(s.numberOfLeaders || 0, "Leaders") + "</div>";

    var m = data.movers || { gaining: [], fading: [] };
    function moverItem(x, cls) {
      var d = cls === "pos" ? "▲" + x.delta : "▼" + Math.abs(x.delta);
      return '<div class="m"><span class="d ' + cls + ' num">' + d + "</span>" + badge(x.carNumber, x.manufacturer, 24) + " " + esc(lastName(x.driverName)) + "</div>";
    }
    var moversCard = '<div class="card"><div class="card-h"><h3>Movers · Last 10 Laps</h3></div><div class="split2">' +
      '<div class="mlist"><div class="drill-h" style="margin:0 0 2px">Gaining</div>' +
      (m.gaining.length ? m.gaining.map(function (x) { return moverItem(x, "pos"); }).join("") : '<p class="note">—</p>') + "</div>" +
      '<div class="mlist"><div class="drill-h" style="margin:0 0 2px">Fading</div>' +
      (m.fading.length ? m.fading.map(function (x) { return moverItem(x, "neg"); }).join("") : '<p class="note">—</p>') + "</div></div></div>";

    var battles = data.battles || [];
    var battleRows = battles.length ? battles.map(function (b) {
      return '<div class="battle">' + badge(b.aCar, null, 24) + " " + esc(lastName(b.aName)) + ' <span class="mut" style="font-size:11px">P' + b.aPos + "</span>" +
        '<span class="mut">vs</span>' + badge(b.bCar, null, 24) + " " + esc(lastName(b.bName)) + ' <span class="mut" style="font-size:11px">P' + b.bPos + "</span>" +
        '<span class="gap2 num">' + b.gap.toFixed(2) + "s " + (b.closing ? "▼" : "▲") + "</span></div>";
    }).join("") : '<p class="note">No side-by-side battles under ' + "0.4s right now.</p>";
    var battlesCard = '<div class="card"><div class="card-h"><h3>Battles Now</h3><span class="more">within 0.4s</span></div>' + battleRows + "</div>";

    var leaders = data.fieldLeaders || [];
    var leaderRows = leaders.length ? leaders.map(function (f) {
      return '<div class="mrow"><span class="lbl">' + esc(f.label) + '</span><span class="bar"><i class="good" style="width:88%"></i></span>' +
        '<span class="val">' + esc(lastName(f.driverName)) + " " + fmtLeader(f) + "</span></div>";
    }).join("") : '<p class="note">Metrics populate once green-flag passing starts.</p>';
    var leadersCard = '<div class="card"><div class="card-h"><h3>Field Loop Leaders · Live</h3></div>' + leaderRows +
      '<p class="note" style="margin-top:6px">Live estimate = live feed × our weekly baselines. Swaps to the official value when loopstats finalizes.</p></div>';

    return chips + moversCard + battlesCard + leadersCard;
  }
  function ovChip(v, l) { return '<div class="chip"><b class="num">' + esc(v) + "</b><span>" + esc(l) + "</span></div>"; }
  function fmtLeader(f) {
    if (f.key === "adjPE" || f.key === "closer") return signed(f.value, f.key === "closer" ? 2 : 1);
    return String(Math.round(f.value));
  }

  // ---------- strategy ----------
  var TIRE_TIER = {
    high: { label: "High tire deg", cls: "neg", blurb: "Fresh tires are worth real lap time here — pit strategy and tire management decide it." },
    moderate: { label: "Moderate tire deg", cls: "warn", blurb: "Tires matter, but track position and the run of cautions weigh in too." },
    low: { label: "Low tire deg", cls: "pos", blurb: "Tires aren't the story here — fuel, the draft, and track position decide it." },
  };

  // Honest per-track context strip: what the calibrated backfill says about this
  // track (tire severity + typical green run), or nothing when uncalibrated.
  function strategyContext(data) {
    var ts = data.trackStrategy;
    if (!ts) return "";
    var t = ts.tireTier && TIRE_TIER[ts.tireTier];
    var run = ts.typicalStintLaps != null ? Math.round(ts.typicalStintLaps) + "-lap typical green run" : "";
    var thin = (ts.tireN != null && ts.tireN < 20) || (ts.stintN != null && ts.stintN < 8);
    var dot = t ? '<span class="tdot ' + t.cls + '"></span>' : "";
    return '<div class="card ctx"><div class="ctx-h">' + dot +
      "<b>" + (t ? esc(t.label) : "Tire deg —") + "</b>" +
      (run ? '<span class="ctx-run">' + esc(run) + "</span>" : "") +
      (thin ? '<span class="ctx-thin">thin data</span>' : "") + "</div>" +
      (t ? '<p class="note" style="margin:4px 0 0">' + esc(t.blurb) + " <span class=\"mut\">Calibrated from historical loop data — an estimate.</span></p>" : "") +
      "</div>";
  }

  function renderStrategy(data) {
    var cycles = (data.pitCycles || []).filter(function (c) { return c.estimatedNextPitLap != null; })
      .sort(function (a, b) { return a.estimatedNextPitLap - b.estimatedNextPitLap; }).slice(0, 12);
    var byId = driverById(data);
    var cycleRows = cycles.length ? cycles.map(function (c) {
      var d = byId[c.driverId] || {};
      var life = c.stintLength ? Math.min(1, (c.lapsSincePit || 0) / c.stintLength) : 0.5;
      var past = life >= 1;
      var recent = (c.lapsSincePit || 0) <= 3;
      var stintFill = Math.max(6, Math.round(life * 100));
      return '<div class="cyc-row' + (recent ? " pitted" : "") + '">' + badge(c.carNumber, d.manufacturer, 26) +
        '<div class="stint"><i class="' + (past ? "old" : "") + '" style="width:' + stintFill + '%"></i></div>' +
        '<span class="st num' + (past ? " neg" : "") + '">' + (recent ? "pitted L" + c.lastGreenPitLap : "L" + c.estimatedNextPitLap + '<small>·est</small>') + "</span></div>";
    }).join("") : '<p class="note">Pit-cycle estimates appear once cars start making green-flag stops.</p>';
    var cycleCard = '<div class="card"><div class="card-h"><h3>Green-Flag Pit Cycle</h3><span class="more">typical run</span></div>' +
      '<p class="note" style="margin:-2px 0 8px"><span class="pos">Green→yellow</span> = into the run; <span class="neg">red</span> = past the typical pit window. Just-pitted cars greyed.</p>' +
      '<div class="cyc">' + cycleRows + "</div></div>";

    var callouts = undercutCallouts(data, byId);
    var undercutCard = '<div class="card"><div class="card-h"><h3>Undercut Watch</h3></div>' +
      (callouts.length ? callouts.join("") : '<p class="note">No clear undercut situations right now — check back after the next cycle of stops.</p>') + "</div>";

    var ctx = strategyContext(data);
    // At low-tire-deg tracks a "tire falloff" chart is noise — suppress the fake precision.
    var tier = data.trackStrategy && data.trackStrategy.tireTier;
    var falloff = tier === "low"
      ? '<div class="card"><div class="card-h"><h3>Tire Falloff</h3></div><p class="note">' +
        esc((data.snapshot && data.snapshot.trackName) || "This track") +
        ' shows little tire falloff — pace here is set by the draft, fuel, and track position, not worn tires.</p></div>'
      : tireFalloffChart(data, byId, tier);

    return ctx + cycleCard + undercutCard + falloff;
  }

  function undercutCallouts(data, byId) {
    var out = [];
    var drivers = data.snapshot.drivers;
    (data.pitCycles || []).forEach(function (c) {
      if (out.length >= 3) return;
      var d = byId[c.driverId];
      if (!d || !d.running) return;
      if ((c.lapsSincePit != null && c.lapsSincePit <= 4) && (d.mover10 != null && d.mover10 > 0)) {
        out.push('<div class="alert"><div class="ai warn">⏱</div><div class="at"><b>' + esc(lastName(d.driverName)) +
          "</b> pitted L" + c.lastGreenPitLap + " on fresh tires and is up " + d.mover10 + " spots since — projected to keep gaining as others cycle through.</div></div>");
      }
    });
    (data.pitCycles || []).forEach(function (c) {
      if (out.length >= 3) return;
      var d = byId[c.driverId];
      if (!d || !d.running) return;
      if (c.lapsSincePit != null && c.stintLength && c.lapsSincePit >= c.stintLength && (d.mover10 != null && d.mover10 < 0)) {
        out.push('<div class="alert"><div class="ai bad">▼</div><div class="at"><b>' + esc(lastName(d.driverName)) +
          "</b> is past its typical run (" + c.lapsSincePit + " laps on tires) and slipping " + Math.abs(d.mover10) + " spots — likely pitting soon.</div></div>");
      }
    });
    return out;
  }

  function tireFalloffChart(data, byId, tier) {
    // Top running contenders' recent lap-speed. This is an OBSERVED pace read
    // (fuel burn + tires + traffic), not modeled tire wear — the caption says so.
    var contenders = data.snapshot.drivers.filter(function (d) { return d.running && (d.spdTrend || []).filter(function (v) { return v != null; }).length >= 3; }).slice(0, 4);
    if (!contenders.length) return '<div class="card"><div class="card-h"><h3>Pace Trend · Leaders</h3></div><p class="note">Pace lines build as green-flag laps accumulate.</p></div>';
    var palette = ["#34d399", "#ffd23f", "#4b83f0", "#f87171"];
    var all = [];
    contenders.forEach(function (d) { (d.spdTrend || []).forEach(function (v) { if (v != null) all.push(v); }); });
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all), range = (max - min) || 1;
    var W = 340, H = 90, lines = "", legend = "";
    contenders.forEach(function (d, idx) {
      var vals = (d.spdTrend || []);
      var coords = [];
      for (var i = 0; i < vals.length; i++) {
        if (vals[i] == null) continue;
        var x = (vals.length === 1 ? 0 : i / (vals.length - 1)) * (W - 6) + 3;
        var y = 78 - ((vals[i] - min) / range) * 62;
        coords.push(x.toFixed(0) + "," + y.toFixed(0));
      }
      if (coords.length < 2) return;
      lines += '<polyline fill="none" stroke="' + palette[idx] + '" stroke-width="2.2" points="' + coords.join(" ") + '"/>';
      legend += '<span style="color:' + palette[idx] + ';font-size:10.5px;margin-right:10px">● ' + esc(lastName(d.driverName)) + "</span>";
    });
    var cap = tier === "high"
      ? "Recent lap speed per contender. This is a high tire-deg track, so a falling line is largely worn tires — a car sliding down is due to pit."
      : "Recent lap speed per contender — an observed pace read (fuel burn + tires + traffic), not tire wear alone. A falling line means a car is losing pace.";
    return '<div class="card"><div class="card-h"><h3>Pace Trend · Leaders</h3></div>' +
      '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '"><polyline fill="none" stroke="#2a3140" stroke-width="1" points="0,78 ' + W + ',78"/>' + lines + "</svg>" +
      '<div style="margin-top:4px">' + legend + "</div>" +
      '<p class="note" style="margin-top:4px">' + cap + "</p></div>";
  }

  // ---------- my driver ----------
  var ALERT_ICON = {
    lead_change: { i: "★", c: "good" }, position_gain: { i: "▲", c: "good" }, position_loss: { i: "▼", c: "bad" },
    pit: { i: "⛽", c: "warn" }, caution: { i: "⚑", c: "warn" }, green: { i: "▶", c: "good" },
    stage_end: { i: "⚑", c: "warn" }, out: { i: "✕", c: "bad" },
  };
  function alertRow(a) {
    var ic = ALERT_ICON[a.kind] || { i: "•", c: "" };
    return '<div class="alert"><div class="ai ' + ic.c + '">' + ic.i + '</div><div class="at">' + esc(a.message) +
      "<time>Lap " + a.atLap + "</time></div></div>";
  }

  function renderMyDriver(data) {
    var drivers = data.snapshot.drivers;
    var opts = drivers.slice().sort(function (a, b) { return String(a.driverName).localeCompare(b.driverName); })
      .map(function (d) { return '<option value="' + d.driverId + '"' + (String(d.driverId) === String(state.followId) ? " selected" : "") + ">" + esc(d.driverName) + " (#" + esc(d.carNumber) + ")</option>"; }).join("");
    var picker = '<div class="card"><div class="card-h"><h3>Follow a driver</h3></div>' +
      '<select id="follow-sel"><option value="">Pick your driver…</option>' + opts + "</select></div>";

    var me = null;
    for (var i = 0; i < drivers.length; i++) { if (String(drivers[i].driverId) === String(state.followId)) { me = drivers[i]; break; } }

    var card = "";
    if (me) {
      var ranks = computeRanks(drivers);
      var mv = moverStart(me);
      card = '<div class="follow"><div class="top"><span class="p num">P' + me.position + "</span>" +
        "<div><div class=\"nm\">" + esc(me.driverName) + " · " + esc(me.carNumber) + "</div><div class=\"sub\">" + esc(me.manufacturer || "") + "</div></div></div>" +
        '<div class="mini-chips" style="margin-top:12px">' +
        chip(me.position === 1 ? "Leader" : (me.gapToLeader == null ? "—" : "+" + Number(me.gapToLeader).toFixed(2)), "To Ldr") +
        chip(mv == null ? "—" : (mv >= 0 ? "▲" + mv : "▼" + Math.abs(mv)), "vs Start") +
        chip(signed(me.adjPassEfficiency), "Adj PE" + (ranks.adjPE[me.driverId] ? " #" + ranks.adjPE[me.driverId] : "")) +
        chip(me.lapsLed == null ? "0" : me.lapsLed, "Laps led") + "</div></div>";
    }

    var prefs = getPrefs();
    var feed = (data.alerts || []).filter(function (a) { return prefs[groupOf(a.kind)] !== false; });
    if (state.followId) {
      // Prioritise the followed driver's own events, keep globals too.
      feed = feed.filter(function (a) { return a.driverId == null || String(a.driverId) === String(state.followId) || ["caution", "green", "stage_end", "lead_change"].indexOf(a.kind) >= 0; });
    }
    var feedCard = '<div class="card"><div class="card-h"><h3>' + (me ? "His Race · Alert Feed" : "Race Feed") + "</h3></div>" +
      (feed.length ? feed.map(alertRow).join("") : '<p class="note">Alerts appear as the race unfolds — lead changes, cautions, big moves, pit stops.</p>') + "</div>";

    var prefCard = '<div class="card"><div class="card-h"><h3>Alerts I Get</h3></div><div class="pit-line" id="alert-prefs">' +
      prefTag("moves", "Position changes", prefs.moves !== false) +
      prefTag("pit", "Pit in/out", prefs.pit !== false) +
      prefTag("flag", "Caution & restart", prefs.flag !== false) +
      prefTag("stage_end", "Stage results", prefs.stage_end !== false) +
      "</div><p class=\"note\" style=\"margin-top:8px\">In-app only for MVP. Saved in this browser — no account needed.</p></div>";

    return picker + card + feedCard + prefCard;
  }
  function prefTag(key, label, on) {
    return '<span class="pit-tag' + (on ? "" : " mut") + '" data-pref="' + key + '"><b>' + (on ? "✓" : "+") + "</b> " + esc(label) + "</span>";
  }
  function groupOf(kind) {
    if (kind === "position_gain" || kind === "position_loss" || kind === "lead_change") return "moves";
    if (kind === "pit" || kind === "out") return "pit";
    if (kind === "caution" || kind === "green") return "flag";
    if (kind === "stage_end") return "stage_end";
    return "moves";
  }
  function getPrefs() {
    try { return JSON.parse(localStorage.getItem("looplab_alertprefs") || "{}"); } catch (e) { return {}; }
  }
  function setPref(key, on) {
    var p = getPrefs(); p[key] = on; localStorage.setItem("looplab_alertprefs", JSON.stringify(p));
  }

  // ---------- idle ----------
  function renderIdle(data) {
    var nr = data.nextRace;
    var next = "";
    if (nr && (nr.name || nr.startTimeUtc)) {
      var when = nr.startTimeUtc ? fmtWhen(nr.startTimeUtc) : "";
      next = '<div class="card"><div class="card-h"><h3>Next Up</h3></div>' +
        '<div class="h-sub" style="color:var(--text);font-weight:600">' + esc(nr.name || "Next race") + "</div>" +
        '<div class="note">' + [esc(nr.trackName || ""), when].filter(Boolean).join(" · ") + "</div></div>";
    }
    return '<div class="card live-empty"><div class="ico">🏁</div>' +
      '<div class="h-title" style="font-size:20px">No session on track</div>' +
      '<p class="note" style="margin-top:6px">The live board wakes up automatically when practice, qualifying, or the race goes green.</p></div>' + next;
  }

  // ---------- data plumbing ----------
  function driverById(data) { var m = {}; data.snapshot.drivers.forEach(function (d) { m[d.driverId] = d; }); return m; }
  var _pitIdx = {};
  function pitOf(id) { return _pitIdx[id] || null; }
  function lastName(full) { var p = String(full || "").trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(" ") : full; }
  function fmtWhen(iso) {
    var t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(" ", "T") + "Z");
    if (!isFinite(t)) return "";
    var d = new Date(t);
    try { return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
    catch (e) { return d.toUTCString(); }
  }

  function bodyFor(tab, data) {
    if (tab === "overview") return renderOverview(data);
    if (tab === "strategy") return renderStrategy(data);
    if (tab === "mydriver") return renderMyDriver(data);
    return renderBoard(data);
  }

  function render() {
    var data = state.data;
    if (!data || !data.snapshot) return;
    _pitIdx = {};
    (data.pitCycles || []).forEach(function (c) { _pitIdx[c.driverId] = c; });

    var hasField = data.snapshot.drivers && data.snapshot.drivers.length > 0;
    if (!hasField) {
      elStatus.innerHTML = "";
      elSubtabs.hidden = true;
      elBody.innerHTML = renderIdle(data);
      updateFoot();
      return;
    }
    renderStatus(data);
    elSubtabs.hidden = false;
    // keep subtab highlight in sync
    Array.prototype.forEach.call(elSubtabs.querySelectorAll("a"), function (a) {
      a.classList.toggle("on", a.getAttribute("data-tab") === state.tab);
    });
    elBody.innerHTML = bodyFor(state.tab, data);
    updateFoot();
  }

  function updateFoot() {
    if (!state.lastOkAt) { elFoot.textContent = ""; return; }
    var ago = Math.max(0, Math.round((Date.now() - state.lastOkAt) / 1000));
    elFoot.textContent = "Updated " + ago + "s ago · unofficial live loop data, for fun";
  }

  // ---------- events (delegated; content re-renders every poll) ----------
  elSubtabs.addEventListener("click", function (e) {
    var a = e.target.closest("a"); if (!a) return;
    state.tab = a.getAttribute("data-tab");
    render();
  });
  elBody.addEventListener("click", function (e) {
    var seg = e.target.closest("#sortseg a");
    if (seg) { state.sort = seg.getAttribute("data-mode"); render(); return; }
    var pref = e.target.closest("[data-pref]");
    if (pref) {
      var key = pref.getAttribute("data-pref");
      var now = getPrefs()[key] === false; // toggling to on
      setPref(key, now);
      render();
      return;
    }
    var row = e.target.closest(".lb-row");
    if (row) {
      var id = row.getAttribute("data-id");
      state.openId = String(state.openId) === String(id) ? null : id;
      render();
      return;
    }
  });
  elBody.addEventListener("change", function (e) {
    var sel = e.target.closest("#follow-sel");
    if (sel) { state.followId = sel.value; localStorage.setItem("looplab_follow", state.followId); render(); }
  });

  // ---------- poll ----------
  function tick() {
    var url = API + "/api/live?series=" + SERIES;
    fetch(url, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.snapshot) return;
      state.data = d;
      state.lastOkAt = Date.now();
      render();
    }).catch(function () { updateFoot(); });
  }
  tick();
  setInterval(tick, POLL_MS);
  setInterval(updateFoot, 1000);
})();

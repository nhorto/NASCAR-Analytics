// Client-side track-type explorer. Fetches per-(driver,season,track-type) rows
// for the series and aggregates them in the browser over the chosen window,
// mirroring the old server trackTypeLeaderboard. Controls update in place.
(function () {
  var series = window.__SERIES__ || 1;
  var app = document.getElementById("tracks-app");

  var TYPES = [
    { type: "superspeedway", label: "Super" },
    { type: "intermediate", label: "Interm" },
    { type: "short", label: "Short" },
    { type: "road", label: "Road" },
    { type: "dirt", label: "Dirt" },
  ];
  var SORTS = [
    { key: "avgFinish", label: "Avg Finish" },
    { key: "avgRating", label: "Rating" },
    { key: "adjPE", label: "Adj Pass Eff" },
    { key: "closer", label: "Closer" },
  ];
  var MIN_OPTS = [3, 5, 8, 10];

  function fmt(n, d) {
    if (n === null || n === undefined) return "—";
    return Number(n).toFixed(d === undefined ? 1 : d);
  }
  function signed(n, d) {
    if (n === null || n === undefined) return "—";
    var v = Number(n).toFixed(d === undefined ? 1 : d);
    return n > 0 ? "+" + v : v.replace("-", "−");
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var DATA = [];
  var seasons = [];
  var maxSeason = 0;
  var state = { type: "road", from: 0, min: 5, sort: "avgFinish" };

  function aggregate() {
    var byDriver = {};
    for (var i = 0; i < DATA.length; i++) {
      var r = DATA[i];
      if (r.type !== state.type || r.season < state.from) continue;
      var g = byDriver[r.id];
      if (!g) {
        g = byDriver[r.id] = {
          id: r.id, name: r.name, starts: 0, wins: 0, top5s: 0,
          finSum: 0, finW: 0, ratSum: 0, adjSum: 0, closSum: 0, loopW: 0,
        };
      }
      g.starts += r.races;
      g.wins += r.wins;
      g.top5s += r.top5s;
      if (r.avgFinish !== null && r.avgFinish !== undefined) { g.finSum += r.avgFinish * r.races; g.finW += r.races; }
      if (r.loopRaces > 0) {
        if (r.avgRating !== null) g.ratSum += (r.avgRating || 0) * r.loopRaces;
        if (r.adjPE !== null) g.adjSum += (r.adjPE || 0) * r.loopRaces;
        if (r.closer !== null) g.closSum += (r.closer || 0) * r.loopRaces;
        g.loopW += r.loopRaces;
      }
    }
    var rows = [];
    Object.keys(byDriver).forEach(function (k) {
      var g = byDriver[k];
      if (g.starts < state.min) return;
      rows.push({
        id: g.id, name: g.name, starts: g.starts, wins: g.wins, top5s: g.top5s,
        avgFinish: g.finW ? g.finSum / g.finW : null,
        avgRating: g.loopW ? g.ratSum / g.loopW : null,
        adjPE: g.loopW ? g.adjSum / g.loopW : null,
        closer: g.loopW ? g.closSum / g.loopW : null,
      });
    });
    rows.sort(function (a, b) {
      var va = a[state.sort], vb = b[state.sort];
      if (va === null) return 1;
      if (vb === null) return -1;
      return state.sort === "avgFinish" ? va - vb : vb - va;
    });
    return rows;
  }

  function href(over) {
    var p = new URLSearchParams();
    p.set("type", over.type || state.type);
    p.set("from", String(over.from || state.from));
    p.set("min", String(over.min || state.min));
    p.set("sort", over.sort || state.sort);
    return "?" + p.toString();
  }

  function seriesPrefix() {
    return series === 2 ? "/xfinity" : series === 3 ? "/trucks" : "";
  }

  function render() {
    var seg = TYPES.map(function (t) {
      return '<a href="' + href({ type: t.type }) + '" data-type="' + t.type + '" class="' +
        (t.type === state.type ? "on" : "") + '">' + t.label + "</a>";
    }).join("");

    var yearOpts = seasons.filter(function (y) { return y <= maxSeason; })
      .map(function (y) {
        return '<option value="' + y + '" ' + (y === state.from ? "selected" : "") + ">" + y + "</option>";
      }).join("");
    var minOpts = MIN_OPTS.map(function (m) {
      return '<option value="' + m + '" ' + (m === state.min ? "selected" : "") + ">" + m + "</option>";
    }).join("");
    var form = '<form class="inline filters" onsubmit="return false">' +
      '<label class="note">Since</label><select data-filter="from">' + yearOpts + "</select>" +
      '<label class="note">Min starts</label><select data-filter="min">' + minOpts + "</select></form>";

    var sortLinks = SORTS.map(function (s) {
      return s.key === state.sort
        ? '<b style="color:var(--accent)">' + s.label + "</b>"
        : '<a href="' + href({ sort: s.key }) + '" data-sort="' + s.key + '">' + s.label + "</a>";
    }).join(" · ");

    var rows = aggregate();
    var typeLabel = (TYPES.find(function (t) { return t.type === state.type; }) || {}).label || state.type;
    var sortLabel = (SORTS.find(function (s) { return s.key === state.sort; }) || {}).label || state.sort;

    var body;
    if (rows.length === 0) {
      body = '<div class="card"><div class="card-h"><h3>No data</h3></div>' +
        '<p class="note">No drivers meet the filters for this track type.</p></div>';
    } else {
      var trs = rows.slice(0, 25).map(function (l, i) {
        var metric = state.sort === "avgFinish" ? fmt(l.avgFinish)
          : state.sort === "avgRating" ? fmt(l.avgRating)
          : signed(l[state.sort], state.sort === "closer" ? 2 : 1);
        return '<tr><td class="mut">' + (i + 1) + '</td><td><a href="' + seriesPrefix() + "/drivers/" + l.id +
          '">' + esc(l.name) + '</a></td><td class="r">' + l.starts + '</td><td class="r">' +
          (l.wins > 0 ? '<b class="pos">' + l.wins + "</b>" : '<span class="mut">0</span>') +
          '</td><td class="r"><b>' + metric + "</b></td></tr>";
      }).join("");
      body = '<div class="card"><div class="card-h"><h3>' + esc(typeLabel) + " · " + esc(sortLabel) +
        '</h3></div><table><tr><th>#</th><th>Driver</th><th class="r">Starts</th><th class="r">W</th>' +
        '<th class="r">' + esc(sortLabel) + "</th></tr>" + trs + "</table></div>";
    }

    app.innerHTML =
      '<div class="seg seg-tracks">' + seg + "</div>" + form +
      '<div class="filter-row"><span class="note num">' + state.from + "–" + maxSeason +
      ' · points races</span><span class="note">' + sortLinks + "</span></div>" + body +
      '<div class="card"><div class="card-h"><h3>About these numbers</h3></div>' +
      '<p class="note">Every column comes from official loop data nobody else surfaces by track type. ' +
      "<b>Adj Pass Efficiency</b>: green-flag passing vs the average car at the same running position. " +
      "<b>Closer</b>: closing-lap position change vs expectation.</p></div>";
  }

  function syncUrl() {
    history.replaceState(null, "", window.location.pathname + href({}));
  }

  app.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-type],a[data-sort]");
    if (!a) return;
    e.preventDefault();
    if (a.getAttribute("data-type")) state.type = a.getAttribute("data-type");
    if (a.getAttribute("data-sort")) state.sort = a.getAttribute("data-sort");
    syncUrl();
    render();
  });
  app.addEventListener("change", function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-filter");
    if (!f) return;
    state[f] = Number(e.target.value);
    syncUrl();
    render();
  });

  fetch("/data/tracktype-" + series + ".json")
    .then(function (r) { return r.json(); })
    .then(function (rows) {
      DATA = rows;
      var seen = {};
      rows.forEach(function (r) { seen[r.season] = 1; if (r.season > maxSeason) maxSeason = r.season; });
      seasons = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
      var p = new URLSearchParams(window.location.search);
      state.type = p.get("type") || "road";
      state.from = Number(p.get("from")) || Math.max(seasons[0] || 0, maxSeason - 7);
      state.min = Number(p.get("min")) || 5;
      state.sort = p.get("sort") || "avgFinish";
      render();
    })
    .catch(function () {
      app.innerHTML = '<div class="card"><p class="note">Could not load track-type data.</p></div>';
    });
})();

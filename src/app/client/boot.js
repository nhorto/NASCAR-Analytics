// Page bootstrap (WS-I). This file exists so the whole site can run under
// `script-src 'self'`: with zero inline <script> bodies and zero `on*=`
// attributes there is no 'unsafe-inline' to allow and no per-page hash to
// compute — which matters because the page config (series id, live Worker
// origin, Pro flag) varies per request, so a hash would have to be threaded
// into the response header and into ~627 static `_headers` rules.
//
// Loaded blocking from <head> on purpose. compare.js / tracks.js / live.js are
// parser-blocking scripts inside <main> and read these globals as they load,
// so a deferred bootstrap would run after them. <body> does not exist yet at
// that point, which is why the config lives on <html>.
(function () {
  var d = document.documentElement.dataset || {};
  window.__LIVE_API__ = d.liveApi || "";
  window.__SERIES__ = Number(d.series) || 1;
  window.__PRO__ = d.pro === "true";

  // --- delegated handlers, replacing the inline on* attributes ---

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || form.nodeName !== "FORM") return;
    if (form.hasAttribute("data-nosubmit")) {
      e.preventDefault();
      return;
    }
    var message = form.getAttribute("data-confirm");
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // Season pickers navigate on change; the selected season's own option has an
  // empty value, so re-picking it is a no-op rather than a reload.
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (!el || el.nodeName !== "SELECT" || !el.hasAttribute("data-nav")) return;
    if (el.value) location.href = el.value;
  });

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-print]") : null;
    if (!el) return;
    e.preventDefault();
    window.print();
  });

  // --- service worker ---

  window.addEventListener("load", function () {
    try {
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
    } catch (err) {
      /* registration is best-effort; the site works without it */
    }
  });

  // --- live indicator on the tab bar ---

  function livedot() {
    if (!window.__LIVE_API__) return;
    fetch(window.__LIVE_API__ + "/api/live/status?series=" + window.__SERIES__, {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (status) {
        if (!status || !status.live) return;
        var el = document.querySelector(".tabbar .tab-live .livedot");
        if (el) el.hidden = false;
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", livedot);
  else livedot();
})();

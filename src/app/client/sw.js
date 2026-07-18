// Looplab service worker — offline shell + static-asset cache.
//
// __ASSET_VERSION__ is stamped by the exporter (the same content-hash that
// cache-busts ?v= asset URLs), so every deploy gets a fresh cache and old ones
// are dropped on activate. Strategy:
//   - navigations: network-first, cache fallback (visited pages work offline)
//   - same-origin static assets (css/js/json/png/manifest): stale-while-revalidate
//   - cross-origin (the live Worker API) and /api/*: NEVER intercepted — live
//     data must stay live.
/* eslint-disable no-var */
var VERSION = "__ASSET_VERSION__";
var CACHE = "looplab-" + VERSION;

var OFFLINE_HTML =
  '<!doctype html><html lang="en"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Offline · Looplab</title>" +
  '<body style="background:#0a0c10;color:#e9edf4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
  'display:flex;align-items:center;justify-content:center;min-height:100dvh;margin:0;text-align:center">' +
  '<div><div style="font-size:34px">🏁</div><h1 style="font-size:20px;margin:10px 0 6px">You&#39;re offline</h1>' +
  '<p style="color:#8b95a6;font-size:14px;margin:0">Pages you&#39;ve visited are available offline.<br>Reconnect for live timing and fresh stats.</p></div></body></html>';

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k.indexOf("looplab-") === 0 && k !== CACHE; })
            .map(function (k) { return caches.delete(k); }),
        );
      })
      .then(function () { return self.clients.claim(); }),
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // live Worker API et al: untouched
  if (url.pathname.indexOf("/api/") === 0) return; // dev-server JSON API: untouched

  // Navigations: network-first so content is always fresh online.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () {
          return caches.match(req, { ignoreSearch: true }).then(function (hit) {
            return hit || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
          });
        }),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  var isAsset = /\.(css|js|json|png|webmanifest)$/.test(url.pathname) || url.pathname.indexOf("/data/") === 0;
  if (!isAsset) return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      var refetch = fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return hit; });
      return hit || refetch;
    }),
  );
});

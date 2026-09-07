// Looplab service worker (WS-H). Config is injected at serve/export time by
// src/app/pwa.ts, so a new deploy produces different bytes and the browser
// installs the new worker automatically.
//
// The cardinal rule here is the privacy one: this cache is shared by every
// person who uses the device, so a personalized response must never enter it.
// Signed-in pages carry `Cache-Control: private, no-store` (WS-D) and account
// and download paths are excluded by prefix as a belt-and-braces second check.
/* eslint-disable no-restricted-globals */
"use strict";

var CONFIG = __SW_CONFIG__;

/** Buckets a request so fetch() can pick a strategy. */
function classifyRequest(url, method, sameOrigin) {
  if (method !== "GET") return "bypass";
  if (!sameOrigin) return "bypass"; // live Worker + analytics: always live
  var path = url.pathname;
  for (var i = 0; i < CONFIG.neverCache.length; i++) {
    if (path.indexOf(CONFIG.neverCache[i]) === 0) return "bypass";
  }
  for (var j = 0; j < CONFIG.networkFirst.length; j++) {
    if (path.indexOf(CONFIG.networkFirst[j]) === 0) return "network-first";
  }
  return "cache-first";
}

/**
 * Whether a fetched response may be stored. Anything personalized, partial,
 * opaque, or unsuccessful is refused.
 */
function shouldCacheResponse(response, hasAuthHeader) {
  if (!response || !response.ok || response.status !== 200) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  if (hasAuthHeader) return false;
  var cc = (response.headers && response.headers.get("Cache-Control")) || "";
  var lowered = cc.toLowerCase();
  if (lowered.indexOf("no-store") !== -1) return false;
  if (lowered.indexOf("private") !== -1) return false;
  // A Set-Cookie on a cacheable-looking response still means per-user state.
  if (response.headers && response.headers.get("Set-Cookie")) return false;
  return true;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CONFIG.cache)
      // Individual failures must not abort the install (a missing optional
      // asset would otherwise leave the site with no worker at all).
      .then(function (cache) {
        return Promise.all(
          CONFIG.shell.map(function (url) {
            return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
          }),
        );
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            // Drop every previous version of our shell cache.
            if (name.indexOf("looplab-shell-") === 0 && name !== CONFIG.cache) {
              return caches.delete(name);
            }
            return null;
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

function networkFirst(request) {
  return fetch(request)
    .then(function (response) {
      if (shouldCacheResponse(response, request.headers.has("Authorization"))) {
        var copy = response.clone();
        caches.open(CONFIG.cache).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        if (request.mode === "navigate") return caches.match(CONFIG.offlineUrl);
        return new Response("", { status: 504, statusText: "Offline" });
      });
    });
}

function cacheFirst(request) {
  return caches.match(request).then(function (hit) {
    if (hit) {
      // Refresh in the background so the next load is current.
      fetch(request)
        .then(function (response) {
          if (shouldCacheResponse(response, request.headers.has("Authorization"))) {
            caches.open(CONFIG.cache).then(function (cache) {
              cache.put(request, response);
            });
          }
        })
        .catch(function () {});
      return hit;
    }
    return networkFirst(request);
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  var sameOrigin = url.origin === self.location.origin;
  var kind = classifyRequest(url, request.method, sameOrigin);
  if (kind === "bypass") return; // straight to the network, never stored
  if (kind === "network-first" || request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

// Exposed so tests can exercise the real shipped decisions rather than a
// re-implementation of them. Harmless in production (no behavior attached).
self.__swTestHooks = {
  classifyRequest: classifyRequest,
  shouldCacheResponse: shouldCacheResponse,
  config: CONFIG,
};

/**
 * sw.js  —  Service Worker
 * ──────────────────────────────────────────────────────
 * Caches all static assets so the app works fully offline
 * after the first visit.  Uses a cache-first strategy for
 * assets and network-first for the Anthropic API.
 */

const CACHE_NAME  = "aoa-v1";
const STATIC_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data/topics.js",
  "./modules/storage.js",
  "./modules/timers.js",
  "./modules/recorder.js",
  "./modules/analysis.js",
  "./modules/feedback.js",
  "./modules/ui.js",
  // Google Fonts will be cached on first use
];

// ── Install: pre-cache all static assets ─────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove stale caches ────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fall back to network ────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always go network-first for the Anthropic API
  if (url.hostname === "api.anthropic.com") {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache valid GET responses (not opaque cross-origin failures)
        if (event.request.method === "GET" && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

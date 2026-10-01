// Deliberately minimal - this app's data (balances, transactions) must never
// be served stale, so this does NOT cache API responses. Its only jobs are:
// (1) satisfy Chrome's PWA installability requirement (a registered service
// worker with a fetch handler is one of the checks behind the automatic
// "Install app" prompt), and (2) cache the static app shell (JS/CSS/icons)
// so the icon/splash still show up the instant the app opens, even on a
// slow connection.
const CACHE_NAME = "treat-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch API calls or non-GET requests - always hit the network so
  // balances/history/etc. are never served from a cache.
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Static app shell: try the network first (so a redeploy is picked up
  // immediately), falling back to the cache only if actually offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

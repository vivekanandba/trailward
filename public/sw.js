/*
 * Trailward service worker (spec 00 "offline-ish", hand-written — no build
 * plugin). Strategy:
 *  - Navigations: network-first, falling back to the cached app shell, so a
 *    deploy propagates on the next online visit but the app still opens at a
 *    signal-less trailhead.
 *  - Same-origin assets (hashed *.js/*.css, icons, treks data baked into the
 *    bundle): cache-first — hashes make them immutable.
 *  - Cross-origin (map tiles, Overpass, weather, geocoding): untouched; the
 *    app already degrades gracefully and tile caching would bloat storage.
 * Bump VERSION to invalidate everything after a breaking SW change.
 */
const VERSION = "v1";
const CACHE = `trailward-${VERSION}`;
const BASE = "/trailward/";

self.addEventListener("install", (event) => {
  // Precache the shell AND the hashed assets it references. The first page load
  // happens before this worker controls the page, so without this the js/css
  // would only get cached on a SECOND visit — and an offline reload after a
  // single visit would render a blank shell.
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll([BASE, BASE + "manifest.webmanifest", BASE + "icon.svg"]);
        const shell = await cache.match(BASE);
        if (shell) {
          const html = await shell.text();
          const assets = [...html.matchAll(/\/trailward\/assets\/[^"' )]+/g)].map((m) => m[0]);
          await cache.addAll([...new Set(assets)]);
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave tiles/APIs alone

  if (req.mode === "navigate") {
    // Network-first: fresh HTML when online, cached shell when not.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(BASE, copy));
          return res;
        })
        .catch(() => caches.match(BASE)),
    );
    return;
  }

  // Cache-first for same-origin subresources (hashed → immutable).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

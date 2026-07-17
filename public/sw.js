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

/** Asset URLs referenced by the cached shell HTML. */
async function shellAssets(cache) {
  const shell = await cache.match(BASE);
  if (!shell) return new Set();
  const html = await shell.clone().text();
  return new Set([...html.matchAll(/\/trailward\/assets\/[^"' )]+/g)].map((m) => m[0]));
}

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
        await cache.addAll([...(await shellAssets(cache))]);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older VERSIONs…
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      // …and prune hashed assets the current shell no longer references — the
      // cache name is stable across deploys, so without this every deploy's
      // assets would accumulate forever.
      const cache = await caches.open(CACHE);
      const live = await shellAssets(cache);
      const entries = await cache.keys();
      await Promise.all(
        entries
          .filter((req) => {
            const path = new URL(req.url).pathname;
            return path.startsWith(BASE + "assets/") && !live.has(path);
          })
          .map((req) => cache.delete(req)),
      );
      await self.clients.claim();
    })(),
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
          // Only a healthy response may become the offline shell — caching a
          // transient 404/500 page would replace the app for offline opens.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(BASE, copy));
          }
          return res;
        })
        .catch(() => caches.match(BASE, { ignoreVary: true })),
    );
    return;
  }

  // Cache-first for same-origin subresources (hashed → immutable). ignoreVary:
  // crossorigin-attributed <script>/<link> requests carry an Origin header, and
  // a `Vary: Origin` on the stored response would make them miss entries cached
  // from origin-less fetches — offline, that miss is a dead asset.
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
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

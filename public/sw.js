/*
 * Trailward service worker (spec 00 "offline-ish", hand-written — no build
 * plugin). Strategy:
 *  - Navigations: network-first, falling back to the cached app shell, so a
 *    deploy propagates on the next online visit but the app still opens at a
 *    signal-less trailhead.
 *  - Same-origin assets (hashed *.js/*.css, icons): cache-first — hashes make
 *    them immutable.
 *  - Trek data cells (/data/cells/*.json): stale-while-revalidate — the names
 *    are STABLE, not hashed, and the weekly cron rewrites them in place, so
 *    cache-first served first-visit data forever (spec 34 follow-up). The
 *    cached cell answers instantly; a background refetch updates the cache for
 *    the next load; offline still works from the cache.
 *  - Cross-origin (map tiles, Overpass, weather, geocoding): untouched; the
 *    app already degrades gracefully and tile caching would bloat storage.
 *  - version.json: network-first. It exists to say WHICH BUILD IS LIVE, so a
 *    cached copy answers the wrong question. It is same-origin, not under
 *    data/, and not a navigation, so it used to fall through to the
 *    cache-first branch and be pinned forever (spec 43 §A).
 *
 * This worker does NOT call skipWaiting(). The activate handler prunes hashed
 * assets the current shell no longer references, so a worker that took over
 * immediately would prune assets a running page still needs — and offline that
 * is a dead app rather than a re-fetch. Waiting means the swap happens when the
 * user accepts, via SKIP_WAITING (spec 43 §B).
 *
 * Bump VERSION to invalidate everything after a breaking SW change.
 */
const VERSION = "v3"; // v3: no skipWaiting (see below), version.json uncached
const CACHE = `trailward-${VERSION}`;
const BASE = "/trailward/";

const ASSET_RE = /\/trailward\/assets\/[^"' )]+/g;

/**
 * Asset URLs the cached shell needs — from the HTML *and* from the CSS it
 * links. Scraping only the HTML misses the two self-hosted font files, which
 * are referenced by url() in the stylesheet, so the prune below was deleting
 * fonts that were very much still in use.
 */
async function shellAssets(cache) {
  const shell = await cache.match(BASE);
  if (!shell) return new Set();
  const html = await shell.clone().text();
  const found = new Set([...html.matchAll(ASSET_RE)].map((m) => m[0]));
  for (const href of [...found].filter((u) => u.endsWith(".css"))) {
    const css = await cache.match(href, { ignoreVary: true });
    if (!css) continue;
    for (const m of (await css.clone().text()).matchAll(ASSET_RE)) found.add(m[0]);
  }
  return found;
}

self.addEventListener("install", (event) => {
  // Precache the shell AND the hashed assets it references. The first page load
  // happens before this worker controls the page, so without this the js/css
  // would only get cached on a SECOND visit — and an offline reload after a
  // single visit would render a blank shell.
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll([BASE, BASE + "manifest.webmanifest", BASE + "icon.svg"]);
      await cache.addAll([...(await shellAssets(cache))]);
      // The cell INDEX, always needed and small: on a first visit the page
      // fetches cells before this worker controls it, so nothing it loaded
      // is cached and an offline reload finds no data at all. Precaching the
      // index means even a first visit leaves something usable behind.
      //
      // Verify what came back rather than using cache.add(): a static host
      // answers an unknown path with the SPA shell — 200 text/html — so a
      // drifted path would store an HTML page under a .json URL, and an
      // offline first visit would then get a 200 that JSON.parse rejects.
      try {
        const index = await fetch(BASE + "data/cells/index.json");
        if (index.ok && (index.headers.get("content-type") || "").includes("json")) {
          await cache.put(BASE + "data/cells/index.json", index.clone());
        }
      } catch {
        // Offline at install time: the index is an optimisation, not a
        // requirement, and failing here must not fail the install.
      }
    }),
    // NB: no skipWaiting() — see the header. A new worker waits.
  );
});

// The page asks for the swap once the user accepts the reload prompt.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
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
      // An EMPTY live set means we could not read a shell that references
      // anything — a missing shell, or one that legitimately has no assets.
      // Pruning on that basis deletes the entire app, which offline is a blank
      // screen. Skipping the prune only costs disk.
      if (live.size > 0) {
        const entries = await cache.keys();
        await Promise.all(
          entries
            .filter((req) => {
              const path = new URL(req.url).pathname;
              return path.startsWith(BASE + "assets/") && !live.has(path);
            })
            .map((req) => cache.delete(req)),
        );
      }
      // claim() IS kept, and is safe precisely BECAUSE skipWaiting is gone.
      // The hazard was taking over while an old page was still running and
      // then pruning its chunks; without skipWaiting a replacement worker does
      // not activate until the user accepts, so by the time this runs there is
      // no old page to strand. On a FIRST install there is no old worker at
      // all, and claiming is what lets that very first visit be cached —
      // without it nothing the page already fetched passes through the worker.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave tiles/APIs alone

  // version.json: never cached. Same-origin and not under data/, so without
  // this it lands in the cache-first branch below and freezes.
  if (url.pathname === BASE + "version.json") return;

  if (req.mode === "navigate") {
    // Network-first: fresh HTML when online, cached shell when not.
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only a healthy response FOR THE APP ROOT may become the offline
          // shell. This used to cache every navigation under BASE, so opening
          // a generated trek page made that page the app shell — and since a
          // trek page references no bundled assets, the next prune then
          // deleted every asset the app has.
          if (res.ok && url.pathname === BASE) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(BASE, copy));
          }
          return res;
        })
        .catch(() => caches.match(BASE, { ignoreVary: true })),
    );
    return;
  }

  // Trek data cells: stale-while-revalidate. Stable filenames + weekly
  // in-place rewrites mean cache-first would pin the first visit's dataset
  // forever; always-network would break the offline trailhead case.
  if (url.pathname.startsWith(BASE + "data/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true });
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => undefined);
        if (hit) {
          event.waitUntil(refresh); // keep the worker alive for the refetch
          return hit;
        }
        return (await refresh) ?? Response.error();
      }),
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

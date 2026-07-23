# 19 — Lazy, on-open enrichment

## Purpose

Most discovery pins — especially the ~5,900 GeoNames summits — ship with only a name, coordinate,
and terrain rank. Baking a photo/summary/town for every one is far too much build work (and
Wikidata, spec 18, proved a near-empty source). Instead, fetch that context **in the browser, the
moment a user opens a pin**: a nearby Commons photo, a nearby-Wikipedia summary, and the nearest
town. Only what's viewed costs anything, so it scales to any number of pins at **zero build/dataset
cost** — and needs no backend, since all three APIs are CORS-enabled.

## A. Client library

`src/lib/enrich.ts`:

- Pure parsers (unit-tested): `parseCommonsPhoto` (generator=geosearch + imageinfo → nearest
  photo + credit), `parseWikiTitle` (list=geosearch), `parseWikiSummary` (REST summary extract,
  drops disambiguation, truncates), `parseNominatimTown` (reverse geocode → town/village/city…).
- `fetchLiveEnrichment(lat, lng, getJson?)` runs the three lookups with `Promise.all`, each
  independent and best-effort (one failing never blocks the others); the summary chains off the
  geosearch title. `getJson` is injectable for tests; the default uses `fetch` against:
  - `commons.wikimedia.org/w/api.php` (`origin=*`) — photo within 2 km,
  - `en.wikipedia.org` geosearch (250 m) + REST `page/summary`,
  - `nominatim.openstreetmap.org/reverse` — nearest town.
    All return `Access-Control-Allow-Origin: *` (verified).

## B. Detail panel

`TrekDetail` fetches once per pin (module-level session cache → reopening is instant, no refetch)
**only** for discovery pins missing baked `image` / `highlights` / `nearestTown`; curated and
already-enriched treks skip the network entirely. Rendered values prefer baked data and fall back
to the live result: `image = trek.image ?? live.image`, etc. A subtle "Looking for nearby photos &
notes…" status shows while fetching; failure just shows less.

## Etiquette

On-open, per-pin lookups are light (one burst per pin the user actually opens, cached thereafter) —
within the Wikimedia/Nominatim usage policies for a low-traffic static site. No key, no backend.

## Verification

- Unit: all four parsers + `fetchLiveEnrichment` orchestration (injected `getJson`: source
  chaining, per-source failure isolation). No network.
- Component: `TrekDetail` renders a fetched photo + summary + town for a bare `gn-*` discovery pin
  (mocked `fetchLiveEnrichment`), and does **not** fetch for a curated trek.

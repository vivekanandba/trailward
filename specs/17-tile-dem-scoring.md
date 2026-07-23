# 17 — Tile-based DEM scoring for listed summits

## Purpose

Spec 16 added ~5,900 GeoNames summits as **unscored** "listed" pins, because DEM-rosette-scoring
that many peaks via per-point elevation APIs would blow the ~1k/day quota. This spec removes that
wall: elevation comes from **AWS "Terrarium" terrain tiles** (S3, free, no key), which are
unlimited and cacheable. Nearby peaks share tiles, so a whole region resolves from a few thousand
cached PNGs instead of tens of thousands of API calls — letting every listed summit get the same
relief/steepness/difficulty/hidden-gem rank as the OSM peaks.

## A. Tile DEM source

`scripts/sources/demtiles.ts`:

- Terrarium encodes metres as RGB: `elevation = R*256 + G + B/256 − 32768`. Tiles are 256×256,
  8-bit truecolour, non-interlaced — decoded with **`node:zlib` alone** (`decodePngRgb`), no image
  dependency (npm is offline; a narrow decoder that throws on any other format is safer than a
  general one anyway).
- Pure helpers (unit-tested): `decodePngRgb`, `terrariumElevation`, `tileForPoint` (Web-Mercator
  tile + in-tile pixel), `sampleElevation` (bilinear).
- `createDemTiles({ z, cacheDir, fetchTile })` → `elevations(points)`, a **drop-in for
  `fetchElevations`**. In-memory + on-disk cache (DEM is static → each tile fetched at most once).
  `fetchTile` is injectable for tests; the default pulls from the allowlisted S3 endpoint via
  `fetchBuffer` (new binary fetch in `http.ts`, throttle relaxed for S3, 404 → null). `DEM_ZOOM`
  is 13 (~18.6 m/px at 13°N, matching SRTM's native ~30 m).

Verified against known peaks: Skandagiri 330 m relief / 13.3°, Savandurga 303 m / 16.7°, a 40 m
coastal noise pin 28 m / 3.2° / confidence 0.10 — the score cleanly separates real hills from noise.

## B. Scoring in build:geonames

`build-geonames.ts` gains a scoring phase (`scoreSummits`) after the dump filter: for each summit,
sample the 9-point rosette from tiles, `computeTerrain`, `scoreDiscovery`, `estimateDifficulty` —
the **same maths the OSM pipeline runs**. GeoNames summits are absent from OSM by definition, so
they're treated as maximally obscure (no wiki/amenity signal); the score is driven by topography.
The scored fields are written into the committed `india-summits.json`. A summit the DEM can't
resolve stays unscored (name + elevation only).

This is still an **occasional hand-run** step (now also downloads tiles, cached under
`scripts/geonames/.cache/`). The weekly cron reads the committed, pre-scored subset — **no tiles,
no DEM calls at cron time.**

## C. Pipeline + UI

`GeonamesSummit` carries the optional scored fields; `toListedTreks` maps them onto the Trek when
present. Scored GeoNames pins therefore **rank with OSM peaks, show the Terrain panel, get a
difficulty-coloured pin, and satisfy the hidden-gems / min-relief filters** — they're no longer
"unverified dots". They remain `verified: false` with a `geonames.org` source (CC-BY).

## Verification

- Unit: `decodePngRgb` round-trip (synthesised PNG), `terrariumElevation`, `tileForPoint`,
  `sampleElevation`, `createDemTiles.elevations` (injected fetcher, cache-hit count, 404→undefined).
  No network.
- End-to-end (manual): known-peak relief sanity (above).
- Data: `npm run build:geonames` scores the subset; `build:discovery` (or the offline append) bakes
  the scored pins; `validate:data` passes.

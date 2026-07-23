# 16 — GeoNames listed summits

## Purpose

OSM misses thousands of named South-Indian hills (Puligundu, Saanarappan Malai, and countless
minor peaks). The **GeoNames** gazetteer (CC-BY 4.0, free, no key) lists ~13k named India
summits — **93% of those within 500 km of Bengaluru are net-new** to our dataset. This spec
adds them as a lightweight **"listed" tier** so the map is far more complete, without blowing
the elevation-API budget.

## Constraint that shapes the design

We can't DEM-rosette-score ~5,000 extra peaks/region (OpenTopoData is ~1k calls/day). So GeoNames
summits are added **unscored**: name + coordinate + GeoNames' own elevation only. They cost **zero
API calls** per peak. OSM peaks keep the full topography rank (relief/slope/prominence/difficulty/
hidden-gem); GeoNames pins fill in coverage beneath them.

## A. Build tool — committed region subset

`scripts/geonames/build-geonames.ts` (npm `build:geonames`) is an **occasional, hand-run** tool,
NOT part of the weekly cron:

- Downloads the GeoNames `IN.zip` dump, filters feature class `T` codes
  `PK/PKS/HLL/HLLS/MT/MTS/RK/RKS`, keeps those within ~520 km of any preset origin.
- Writes a compact committed subset `scripts/geonames/india-summits.json`
  (`{ id, name, lat, lng, elevationM? }[]`), ~7.5k rows, ~650 KB.
- The `.cache/` (dump) is git-ignored; the cron reads only the committed subset, so it stays fast
  and no-download. Refresh by re-running `npm run build:geonames`.

## B. Source module

`scripts/sources/geonames.ts` → `geonamesSummitsNear(origin, radiusKm): GeonamesSummit[]` reads
the committed subset and filters by haversine distance. Missing file → `[]` (degrades cleanly).

## C. Pipeline merge

In `discover-precompute.ts`, after the OSM/manual peaks are scored, enriched, and trail-attached:

- `toListedTreks(summits, scored, regionSlug, cityId)` (pure) converts summits to discovery-tier
  treks with **no** `discoveryScore`/`reliefM`/`estimatedDifficulty`, `id` = `gn-<geonameid>--<region>`,
  `sources` = `[https://www.geonames.org/<id>]` (CC-BY attribution + link), `verified: false`.
- Dedupe (grid-bucketed, 250 m) against every already-scored peak **and** against each other, so a
  GeoNames summit that IS an OSM/manual peak isn't double-pinned.
- Appended after the ranked peaks (no score → they sort last), then the existing
  `dedupeAgainstCurated` in `main()` also removes any that coincide with a curated trek.

## D. UI

- Listed pins have no difficulty → they render in the **slate discovery colour** and read
  "Unverified"; the map's viewport culling already handles the higher pin count.
- The list rail **caps rendered rows at 300** (data order is curated → ranked discovery → listed,
  so the top stays most relevant) with a "+N more on the map — zoom/search/filter" footer. All
  pins remain on the map and reachable via search/filters.
- Terrain filters (hidden-gems, min-relief) naturally exclude listed pins (no score/relief), which
  is the intended way to narrow from "everything listed" down to "topography-ranked only".

## Verification

- Unit: `toListedTreks` (mapping, elevation omit, dedupe vs scored + vs self), `precomputeRegion`
  appends listed below ranked, `geonamesSummitsNear` radius filtering. Injected fakes / committed
  subset — no network.
- Data: `npm run build:discovery` then `npm run validate:data`; confirm `gn-*` pins appear and the
  ranked peaks still lead.
- Licence: GeoNames is CC-BY 4.0 — attribution is the per-pin `geonames.org` source link.

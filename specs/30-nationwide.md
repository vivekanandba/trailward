# 30 — Nationwide, region-free, any-city

## Purpose

Three coupled problems, one redesign:

1. **Pins were tied to a city.** Every record carried a `cityId` and the app showed only the
   active preset's records — the same summit was duplicated per region (8,690 duplicate records)
   and invisible from anywhere else.
2. **Search was preset-only.** A non-preset origin fell back to thin live-Overpass results.
3. **One data blob doesn't scale to India.** The single 22 MB dataset chunk was already at its
   limit; nationwide data (detection over the Himalaya to come) makes it impossible.

## Region-free records

Discovery ids drop the `--region` suffix (`gn-123--bengaluru` → `gn-123`); one summit is one
record, reachable from anywhere. `cityId` is optional (curated records keep theirs; discovery has
none). `scripts/migrate-region-free.ts` collapsed 43,191 → **34,501** records, merging every
enrichment field any duplicate carried (a real name always beats an "Unnamed…" placeholder).

## Cell-chunked serving

`scripts/chunk-data.ts` (`build:chunks`) derives **1°×1° cell files** +
`public/data/cells/index.json` from the canonical `src/data/treks.json`; both cron workflows
re-chunk after writing data. The app (`src/lib/cells.ts`) fetches the index once, then exactly the
non-empty cells the current origin+radius touches (session-cached, parallel; a failed cell retries
on the next call). Result: **the dataset left the JS bundle entirely** (app JS fell to ~35 KB
gzipped) and payload now scales with _where you look_, not with how much India we cover. 73 cells
today; the largest is 1,657 records.

## Any-city search

The app filters by **distance from whatever origin is chosen** — preset chip, geocoded search, or
geolocation — with a universal 500 km radius cap. Live Overpass discovery is gone (the baked data
covers everywhere the pipeline has processed). Because cells arrive in arbitrary order, the app
restores canonical ranking before the 300-row list cap: curated → hidden-gem score → relief.

## Pipeline restructure (weekly cron)

- **OSM enrichment islands**: per-preset-origin Overpass discovery (Overpass can't swallow an
  all-India peaks query), emitting region-free ids; a failed region's prior records are preserved
  (kept when outside every _successful_ region's radius).
- **Nationwide layers**: GeoNames listed summits and terrain-detected summits are merged ONCE for
  all of India (`geonamesSummitsAll` / `detectedSummitsAll`), deduped against every named pin.
- `preserveEnrichment` (spec 25B) still carries hand-baked fields across regeneration;
  `build:hillfeatures` now budgets its Overpass calls per 1° cell instead of per region.

## Coverage note

The architecture is nationwide as of this spec; the _data_ grows in follow-ups: all-India
GeoNames (13,153 summits — REACH filter removal), all-India climate/names/landcover, and the
all-India z12 detection scan (long tile download; Himalaya-banded thresholds).

## Verification

Unit: cell maths (keying, conservative radius cover), loader (index-once, listed-cells-only,
caching, failed-cell retry), migration helpers (suffix stripping, enrichment-merging,
name-preference), pipeline tests on region-free ids. e2e: **Mysuru — never a preset — shows >50
ranked peaks by distance alone**; all prior flows green. `validate:data` on the migrated set.

# 25 — Alternate names & enrichment persistence

## A. Alternate names (GeoNames `alternatenames`)

The GeoNames dump's column 3 carries other names a place goes by — colonial-era ("West Hill" =
"Conollys Hill"), transliteration variants, regional names ("Western Ghāts" = "Sahyadri"). It was
already sitting in our cached `IN.txt`, unused: **zero network cost**.

`pickAltNames` (pure, tested) keeps display/search-worthy variants only: Latin script (the UI and
search are Latin-input), deduped against the primary name and each other
case/diacritic-insensitively, ≤40 chars, capped at 3. The strict filter reduces the raw 2,951
summits-with-alternates to **122 genuine variants** (79 on shipped pins) — small but real: a user
searching "Sahyadri" or "Conollys" now finds the peak.

- Model: `altNames?: string[]` (validated, short non-empty strings).
- Search: `applyFilters` includes altNames in the free-text haystack.
- Detail: an "Also known as …" line above the description.
- Pipeline: baked into `india-summits.json` by `build:geonames`; `toListedTreks` carries it.

## B. Enrichment persistence across cron regenerations (bug fix)

`build:discovery` (the weekly cron) regenerates discovery records wholesale. Fields baked by the
HAND-RUN tools — `bestSeason` (build:climate), `historicalNote` (build:gazetteer),
`hillFeatures` / `protectedArea` / `heritage` (build:hillfeatures) — existed only in `treks.json`,
so the next cron run would have **silently wiped all of them**.

`preserveEnrichment(next, previous)` (pure, tested) copies those fields from the previous dataset
onto regenerated records with the same id, applied in the pipeline's write path. A value the fresh
run produced itself (e.g. hillFeatures fetched live for a trail-enriched peak) always wins over the
preserved one; records with no previous counterpart are untouched.

## Verification

Unit: `pickAltNames` (Latin filter, diacritic dedup, cap), `preserveEnrichment` (carry-over,
fresh-wins, new-record untouched), search-by-alternate-name in `applyFilters`, validation, and the
"Also known as" render. Data: altNames patched onto 79 shipped gn pins; `validate:data` passes.

# 18 — Wikidata cross-match (hidden-gem honesty)

## Purpose

GeoNames summits are DEM-scored (spec 17) but carry **no notability signal**, so a famous rugged
peak (e.g. Vavul Mala) reads as a "hidden gem" purely on terrain. Wikidata can fix that: a summit
that also exists in Wikidata is, by definition, _known_. Joining on the GeoNames ID (P1566) lets us
down-weight the hidden-gem score of the known subset so that ranking stays honest.

## Measured yield (why this is a lean tweak, not a pipeline)

Over Bengaluru's 500 km radius, ~828 Wikidata mountains carry a GeoNames ID, but only **~8 have a
photo (P18)** and **~7 an English Wikipedia article**. So Wikidata is _not_ a useful photo/article
source (spec 19's spatial Commons/Wikipedia lookup is). Its one worthwhile signal is "this peak is
known" → a score down-weight. Across all five regions the pass re-scores **~1,400 summits** and
grabs the **handful of photos** for free.

## Design

`scripts/sources/wikidata.ts`:

- `parseWikidataMatches(json)` (pure, tested) → `Map<geonamesId, { hasArticle, image? }>`, merging
  duplicate rows.
- `fetchWikidataKnown(origin, radiusKm)` → one batched SPARQL **box** query per region for mountains
  (`P31/P279* Q8502`) with a GeoNames ID, optional P18 image + en.wikipedia sitelink. Via the
  allowlisted `query.wikidata.org` (60 s timeout — box scans are slow).

`build-geonames.ts` `crossMatchWikidata` (after DEM scoring): for each summit found in Wikidata,
re-score with `hasWikidataTag: true` (+ `hasWikipediaTag` when an article exists) using the existing
`scoreDiscovery`, and attach a P18 photo when present. Best-effort per region — a failed/slow query
leaves that region's topography-only scores intact.

The refined scores are written into the committed `india-summits.json`; `toListedTreks` maps the
optional `image` onto the Trek. **No cron cost** — like the rest of `build:geonames`, this is the
occasional hand-run step; the weekly cron reads the pre-computed subset.

## Verification

- Unit: `parseWikidataMatches` (keying, row merge, empty/missing tolerance). No network.
- Data: re-run `build:geonames`; hidden-gem count drops (3,585 → 3,276 for the current subset) as
  known peaks are demoted (Vavul Mala 0.94 → 0.78); `validate:data` passes.

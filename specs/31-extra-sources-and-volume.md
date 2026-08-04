# 31 — Extra named sources, name inference v2, UI volume, drift guard

## Purpose

After the all-India detection bake (spec 27/30) most pins are honest "Unnamed peak" placeholders.
This spec names as many as open sources allow, and gives the UI controls to tame the rest —
plus the two safety nets the integration taught us we need.

## Extra named summits (`scripts/build-summits-extra.ts`, hand-run: `npm run build:extra`)

Two sources our pipeline never swept nationwide:

- **OSM** `natural=peak/hill` nodes with a `name`, fetched in 2° latitude bands (an all-India
  Overpass query times out). The weekly cron only queries OSM around preset cities, so most of
  India had never been asked. ODbL, no key.
- **Wikidata** mountains in India (`P31/P279* Q8502`, `P17 Q668`, with `P625` coordinates),
  paged through the CC0 SPARQL endpoint with Indian-language label fallback (en → hi/kn/ta/te/
  ml/mr/bn) — regional-Wikipedia-only peaks that GeoNames lacks.

Both are India-masked (the GeoNames density mask from spec 27), deduped on a ~250 m grid (OSM
beats Wikidata — surveyed positions over imported ones), terrain-scored offline from the cached
z12 tiles (same maths as build:geonames), and committed to
`scripts/extra/india-extra-summits.json`. `discover-precompute` merges them into the listed
layer (`toListedTreks` — extras carry `fullId` `osmx-<node>` / `wd-Q…` and their own source
link). Where one lands within 400 m of a terrain-detected pin, the named pin replaces it at the
next rebake: an "Unnamed peak" gains its name.

## Name inference v2 (`nameinfer.ts` village rule)

Ordinary villages never name a summit (they sit at the base and share names across a taluk) —
EXCEPT when the village's own name says it's a hill: "Huliyurdurga" at the base of the fort
rock IS the hill's name. Rule: plain `PPL/PPLL/PPLX` features only (never `PPLA*/PPLC` admin
seats — Chandigarh must not name a knoll), within 1 km, name ends in a hill word
(betta/gudda/konda/malai/giri/durga/garh/pahar/dongar/tekdi/dhar/tibba/kangri/…), kept whole,
never stripped. An ON-hill feature (forest/temple/pass) always outranks it.

## UI volume (spec 30's "filters do the capping", applied to 105k detected pins)

- **"Named pins only"** filter toggle (session-only, like hidden-gems) — hides `Unnamed …` pins
  from list AND map in one switch.
- Unnamed pins render **recessive** on the map (smaller, translucent, thinner halo) so named
  summits read first; selection restores full prominence.
- Existing min-relief slider + clustering + viewport culling already bound the rest.

## Safety nets (the integration's two lessons, mechanised)

- **`preserveEnrichmentByLocation`** — coordinate-based fallback (120 m) run after id-keyed
  `preserveEnrichment` in every rebake: a rescan that regenerates detected ids (spec 27 caveat)
  can no longer orphan enrichment. Occupancy spacing (≥250 m between pins) means only
  cross-generation matches are possible.
- **`scripts/check-enrichment-drift.ts`** — the weekly refresh workflow now diffs per-field
  counts (records, non-Unnamed names, bestSeason, landCover, historicalNote, hillFeatures,
  protectedArea, heritage) against committed HEAD and refuses to commit on a >2% drop. A bake
  that "succeeds" while silently stripping fields (the WorldCover poisoning incident) fails CI
  instead of shipping.

## Verification

Unit: Overpass/SPARQL parsers (elevation sanity, WKT lng-first order, label-less Q-ids
dropped), extras dedupe, `toListedTreks` id/source override + occupancy, village namer rule
(hill-word gate, 1 km radius, loses to on-hill features), location carryover (40 m id-shift
carries, 550 m doesn't), drift-guard counting + tolerance. Data: rebake counts diffed via the
drift guard itself. E2E: "Named pins only" hides unnamed rows.

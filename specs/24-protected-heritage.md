# 24 — Protected areas & heritage designations

## Purpose

Two facts change how you plan a trek and neither was captured anywhere:

1. **The summit sits inside a protected area** (wildlife sanctuary, national park, conservation
   reserve) — entry there is usually regulated: permits, timings, sometimes outright closure.
2. **There's a formally protected monument on the hill** (ASI "Monument of National Importance",
   State Protected Monument) — a strong reason-to-visit signal, verified by an authority rather
   than inferred from tags.

## Sources (both verified by probe)

- **OSM boundaries via Overpass `is_in`** — resolves a point to its enclosing polygons.
  Verified: BR Hills → "Biligiri Ranganatha Swamy Temple (BRT) Wildlife Sanctuary".
  `parseProtectedArea` (pure) reads the `type:"area"` elements, prefers `boundary=protected_area`
  over a generic `leisure=nature_reserve`, skips unnamed areas, and deliberately ignores plain
  `landuse=forest` — nearly every hill sits in _some_ forest polygon, and that tells a trekker
  nothing about entry rules.
- **Wikidata P1435 (heritage designation)** — 48 Monuments of National Importance + 10 State
  Protected Monuments in a small bbox near Bangalore alone. One batched SPARQL box query per
  region (`fetchHeritageSites` / `parseHeritageSites`), matched locally to summits within
  **600 m** (`matchHeritage`).

## Model

`protectedArea?: string` (the enclosing area's name) and `heritage?: string` (the designation
label), both validated as non-empty strings.

## Where it runs

`build:hillfeatures` (hand-run) — the summit-features Overpass call now also appends
`is_in(lat,lng)` for the enclosing boundaries, so **protected areas cost no extra request**; the
heritage pass adds one SPARQL query per region. Fields are rebuilt for every re-queried summit
(stale values cleared), targets = curated + trail/POI carriers + top-12 discovery per region.

## UI

- `Protected area` as a Fact row — states where you are, not invented advice.
- Heritage as an amber chip beside the difficulty badge, titled "Heritage designation from
  Wikidata".

## Verification

Unit: `parseProtectedArea` (named-boundary preference, unnamed skipped, non-area elements ignored),
`parseHeritageSites` (coordinate + label extraction, junk tolerance), `matchHeritage` (600 m accept
/ reject). Component render is covered by the Fact/chip patterns already under test. No network.

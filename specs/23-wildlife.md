# 23 — Wildlife recorded nearby (GBIF)

## Purpose

Biodiversity is a real reason to visit a hill, and **GBIF** publishes hundreds of millions of
geo-referenced occurrence records under open licences — free, no key, CORS-enabled. Near Savandurga
alone there are ~29,000 bird/mammal records.

## Design — lazy, like spec 19

Fetched **in the browser when a pin is opened**, alongside the photo/summary/town lookup, and cached
per session. Zero build cost and zero dataset growth, so it scales to all ~5,900 discovery pins.

- Query: `~5 km` bounding box, `taxonKey=212` (Aves) + `359` (Mammalia). Birds and mammals are what
  a walker actually notices, and it keeps the list short.
- `parseWildlife` (pure, tested) returns `{ records, species[] }`: the total record count plus up to
  six **distinct binomials**.

## Honesty constraints

- **Scientific names only.** GBIF occurrence records carry no vernacular names (verified — the
  `vernacularName` field is absent), so we show _Macaca radiata_, not an invented "bonnet macaque".
  Guessing common names would be fabrication.
- Genus-only and authored rows (`"Tachyspiza Kaup, 1844"`) are dropped — they aren't species.
- The panel says "**Occurrence records, not a sighting guarantee**", because that is exactly what
  the data is: someone recorded this taxon near here at some point.

## Verification

Unit tests: count + distinct-binomial extraction, duplicate collapsing, trimming an authored name to
its binomial, rejection of genus-only rows, list cap, and junk tolerance. The orchestration test
asserts wildlife is fetched alongside the other sources and that one source failing doesn't block
the rest. No network.

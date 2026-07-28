# 23 — Wildlife recorded nearby (iNaturalist) + Wikivoyage

## Purpose

Biodiversity is a real reason to visit a hill. The original implementation used **GBIF**, whose
occurrence records carry only scientific names; it was replaced with **iNaturalist** (free, no key,
CORS), whose research-grade observations carry a **preferred common name** ("Indian Chameleon") and
a **CC-licensed photo with photographer attribution** — strictly better for display, with nothing
invented. Near Savandurga: ~490 research-grade bird/mammal/reptile/amphibian observations.

Also added here: a nearby **Wikivoyage** article (title + first-paragraph summary + link) in the
same lazy fetch. Coverage is sparse — only notable destinations have articles — but the content is
practical (getting there, timings) and high quality where it exists.

## Design — lazy, like spec 19

Fetched **in the browser when a pin is opened**, alongside the photo/summary/town lookup, and cached
per session. Zero build cost and zero dataset growth, so it scales to all ~5,900 discovery pins.

- Query: research-grade observations within 5 km, `order_by=votes` (well-confirmed, charismatic
  species first), iconic taxa Mammalia/Aves/Reptilia/Amphibia.
- `parseWildlife` (pure, tested) returns `{ records, species[] }` where each species carries
  `{ name, photo?, attribution? }` — common name preferred, binomial fallback, square CC thumbnail.
- `parseVoyage` (pure, tested) turns a Wikivoyage geosearch hit into `{ title, url }`; the fetch
  shell chains the REST summary onto it.

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

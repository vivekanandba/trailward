# 21 — Gazetteer historical context

## Purpose

For small South Indian hills, the richest surviving description is often a century old. The
**Imperial Gazetteer of India (1908)** is public domain and hosted as OCR'd text on archive.org,
and its entries are structured — `Name.—Description…` — frequently carrying a coordinate, an
elevation, and detail that exists nowhere else online.

## The safeguard: three independent checks

Attaching the wrong note is worse than attaching none (an earlier feature mislabelled peaks by
matching on name proximity alone). A gazetteer entry is only attached when **all three** agree:

1. **Name** — normalised (diacritics stripped, generic words like _hill/betta/malai/gudda_ removed);
   prefix matches allowed only for names ≥5 chars.
2. **Coordinate** — parsed from the entry's own DMS text and within **5 km** of our pin. Entries
   with no parseable coordinate are discarded outright; a name is never enough.
3. **Elevation** — when the entry states one, it must be within **150 m** of our DEM.

That third check turned out to be a strong signal: the 1908 trigonometrical survey agrees with the
modern DEM to within **1 m** on Nandi Hills (1479 vs 1478 m), Savandurga (1227 vs 1226 m) and
Gopalswamibetta (1454 vs 1454 m) — so a large disagreement really does mean a different hill.

## Implementation

- `scripts/sources/gazetteer.ts` (pure, tested): `parseDms` (OCR-tolerant — repairs `o`→`0` in
  minutes), `parseCoords` (subcontinent bounds guard), `parseElevationFt`, `excerpt` (de-hyphenates
  across line breaks, cuts on a sentence then word boundary), `parseGazetteerEntries` (splits on
  entry heads, drops administrative units — District/Tahsil/Village — and anything without a
  coordinate), `nameKey`, `elevationsAgree`, `matchEntries` (nearest wins per trek).
- `scripts/build-gazetteer.ts` (hand-run, `npm run build:gazetteer`): archive.org identifiers for
  these scans are wildly inconsistent (`dli.*`, `in.ernet.*`, `rbanms.*`), so volumes are
  **discovered via the search API** and ranked (southern provincial series and alphabetical spans
  first) rather than hardcoded. Text is cached under `scripts/.cache/gazetteer`, so re-runs need no
  network. A trek that no longer matches has its note dropped, keeping re-runs honest.

## Result

258 coordinate-bearing summit entries → **10 verified matches**, including genuinely obscure hills
(_"Nunke Bhairavana Betta — a bare rocky hill, 3,022 feet high, in the north-east of Chitaldroog
District"_). Modest in count, unique in value.

## Presentation

Stored as `historicalNote {text, source, year, url}` — deliberately **not** merged into
`highlights`, because it describes the place as it was in 1908. The panel always renders it under a
"Historical note" heading with the source, the year, and the caveat that _place names and conditions
have changed_.

## Verification

Unit tests cover every parser plus the three guards — including explicit tests that a matching name
far away is **rejected**, a nearby peak with a different name is **rejected**, and a same-name hill
at a wildly different height is **rejected**. No network.

# 02 — Data Pipeline

## Purpose

Produce a validated `src/data/treks.json` from free public sources + ethical build-time scraping,
so the app ships accurate, attributed data with no runtime cost for the default origin.

## User stories

- As the **maintainer**, I want one command (`npm run build:data`) to (re)generate the dataset.
- As the **maintainer**, I want every field traceable to a source URL so I can re-verify later.
- As a **reviewer**, I want each source handled by a small, separately testable module.

## Acceptance criteria

- **Given** the curated seed list for Bangalore, **when** the pipeline runs, **then** it outputs
  ≥15 valid curated `Trek` records, each with ≥1 source and `verified: true`.
- **Given** a source response, **when** parsed, **then** the parser is a pure function of input →
  partial `Trek` fields (testable against recorded fixtures, no live network in tests).
- **Given** conflicting values across sources, **when** merging, **then** a documented precedence
  applies (curated/manual > Wikidata > OSM tag > scraped blog) and the chosen source is recorded.
- **Given** the merged output, **when** the pipeline ends, **then** every record passes
  `validateTrek` (01); a single failure fails the whole run with a clear message.

## Interfaces & data contracts

**Modules (each pure-parser + a thin fetch wrapper):**

```ts
// scripts/sources/*
fetchPeaks(originLatLng, radiusKm): Promise<RawPeak[]>          // Overpass
parsePeaks(overpassJson): Partial<Trek>[]                       // pure
fetchElevation(points): Promise<Map<id, number>>               // Open-Meteo
fetchRoute(origin, dest): Promise<{ distanceKm; driveTimeMin }> // OSRM
fetchWiki(title): Promise<{ summary; image?: TrekImage }>      // Wikipedia/Commons
scrapeDetails(url): Promise<Partial<Trek>>                      // cheerio, build-time only
mergeTrek(parts: Partial<Trek>[]): Trek                         // pure, applies precedence
```

- **Seed list:** `scripts/seed/bangalore.ts` — curated names + canonical coords + known source
  URLs. The pipeline enriches these; it does not invent treks for curated origins.
- **Fixtures:** recorded sample responses in `tests/fixtures/` drive parser tests offline.
- **HTTP:** `undici` with a descriptive `User-Agent`, ≤1 req/s per host, retries with backoff.

**Source roles:**

| Source                       | Provides                                | Key? |
| ---------------------------- | --------------------------------------- | ---- |
| Overpass (OSM)               | peak coords, elevation tag, discovery   | no   |
| Open-Meteo                   | elevation (DEM), live weather (runtime) | no   |
| OSRM                         | road distance + drive time from origin  | no   |
| Wikipedia/Wikidata           | summary, coordinates                    | no   |
| Wikimedia Commons            | CC-licensed photo + attribution         | no   |
| Scrape (Forest dept / blogs) | fees, permits, difficulty, notes        | no   |

## Edge cases & error states

- A source times out / 5xx → retry, then skip _that field_ (don't fail the whole trek if optional).
- Missing elevation from OSM → fall back to Open-Meteo; if both fail, leave `elevationM` unset.
- Scrape target layout changed → parser returns empty partial + logs a warning (not a crash).
- Robots.txt disallows a path → skip it; never bypass.
- We never fetch AllTrails or Google Maps/Places (ToS); enforced by an allowlist of hosts.

## Test cases (TDD checklist)

- `parsePeaks` turns a recorded Overpass fixture into the right partials (count, coords, ele).
- `mergeTrek` precedence: given conflicting elevation, picks the higher-priority source and
  records it in `sources`.
- Elevation fallback: OSM missing → Open-Meteo value used.
- A malformed/HTML-changed scrape fixture yields an empty partial, not a throw.
- End-to-end (mocked fetch): seed list → ≥15 valid curated records, all passing `validateTrek`.
- Host allowlist rejects a disallowed domain.

## Out of scope

- Live discovery at runtime (→ 03 uses the same Overpass parser but in the browser).
- Scheduling (→ 10).

## Open questions

- Photo policy: only Commons (safest licensing) for now — confirm that's acceptable vs. allowing
  curated manual image URLs with explicit attribution.

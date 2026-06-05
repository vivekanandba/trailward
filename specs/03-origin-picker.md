# 03 — Origin Picker (dynamic location)

## Purpose

Let the user measure treks from **any place**, not just Bangalore: search a location, recenter the
map and radius origin, and show curated data where we have it or live-discovered peaks elsewhere.

## User stories

- As a **visitor in another city**, I want to type my city and see treks around me, even if
  Trailward hasn't curated it yet.
- As a **Bangalore user**, I want the app to just work with rich data by default, no searching.
- As a **returning user**, I want my last chosen origin remembered.

## Acceptance criteria

- **Given** a fresh visit, **when** the app loads, **then** the origin is **Bengaluru** and
  curated Bangalore treks render with **no network call**.
- **Given** the user types a place and selects a suggestion, **when** confirmed, **then** the map
  recenters on the geocoded coords and the radius ring redraws from there.
- **Given** the chosen origin has curated treks (`cityId` match), **when** displayed, **then**
  curated records are shown (discovery may supplement but curated takes precedence by id/coords).
- **Given** the chosen origin has **no** curated treks, **when** displayed, **then** the app
  queries Overpass live within the current radius and shows discovery pins with a
  "community / unverified" badge.
- **Given** the user reloads, **when** the app starts, **then** the previously chosen origin is
  restored from `localStorage`.

## Interfaces & data contracts

```ts
// src/lib/geocode.ts (Nominatim)
geocode(query: string): Promise<GeocodeResult[]>; // { name, lat, lng, displayName }
// src/lib/overpass.ts (shares parsePeaks with the pipeline)
discoverPeaks(origin: Origin, radiusKm: number): Promise<Trek[]>; // tier: "discovery"

// persistence
const ORIGIN_STORAGE_KEY = "trailward.origin";
loadOrigin(): Origin;        // returns DEFAULT_ORIGIN if none/invalid
saveOrigin(o: Origin): void;
```

- Nominatim usage policy honored: debounce input (≥400 ms), ≤1 req/s, descriptive `User-Agent`/
  `Referer`, cache results per query string in-memory + `localStorage`.
- Overpass discovery reuses `parsePeaks` from 02 to keep one parser.

## Edge cases & error states

- Geocode returns no results → inline "no place found", origin unchanged.
- Geocode/Overpass network error → toast/inline notice; keep the last good origin + curated data.
- `localStorage` unavailable (private mode) → fall back to in-memory; default origin each load.
- Discovery returns 0 peaks (flat region) → show "no peaks found within X km", suggest widening
  radius.
- Very large radius + dense region → cap discovery results (e.g. top N by elevation) and **log/
  surface** that the list was truncated (no silent cap).

## Test cases (TDD checklist)

- `loadOrigin` returns `DEFAULT_ORIGIN` when storage empty/corrupt; round-trips a saved origin.
- Default load path triggers **zero** geocode/Overpass calls (mocked + asserted).
- Selecting a curated city shows curated treks; selecting a non-curated place calls
  `discoverPeaks` (mocked) and renders discovery-tier pins with the badge.
- Debounce: rapid typing fires at most the throttled number of geocode calls.
- Error paths render a notice and preserve prior state.

## Out of scope

- The map rendering itself (→ 04). Curating new cities (a pipeline re-run, → 02/10).

## Open questions

- Should we ship a small curated **shortlist of city presets** (Bangalore, Pune, Mumbai…) as
  quick chips alongside free-text search? (Lean: yes for Bangalore now, chips later.)

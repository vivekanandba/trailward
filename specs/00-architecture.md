# 00 — Architecture

## Purpose

Define the overall shape of Trailward so every other spec slots into a consistent whole: a
**static** site fed by a **build-time data pipeline**, hosted free with **no backend**.

## User stories

- As the **maintainer**, I want all heavy data work to happen at build time so the live site has
  no servers, keys, or bills to manage.
- As a **visitor**, I want pages to load instantly and work offline-ish (no spinner waiting on a
  backend) for the default Bangalore experience.
- As a **contributor**, I want a clear seam between "data production" and "the app" so I can work
  on one without breaking the other.

## Acceptance criteria

- **Given** the app is built and deployed, **when** a visitor opens the default view, **then** no
  network calls to third-party APIs are required to render the Bangalore map and pins (data comes
  from the bundled `treks.json`).
- **Given** a visitor changes the origin to a non-curated place, **when** the app needs pins,
  **then** it may call public APIs (Overpass/Nominatim) directly from the browser — these are the
  only network dependencies, and a failure degrades gracefully (see 03).
- **Given** the data pipeline runs, **when** it finishes, **then** it writes a single committed
  artifact `src/data/treks.json`; the app never imports pipeline code.
- **Given** any module, **when** inspected, **then** it belongs to exactly one layer below.

## Interfaces & data contracts

**Layers (dependency arrows point downward only):**

```
UI components (src/components/*)        ← React + Leaflet, presentation
  └─ uses → app state + lib (src/lib/*) ← pure logic: distance, filters, geocode, overpass
        └─ reads → data (src/data/*)    ← treks.json + origins (static)

pipeline (scripts/*)  → writes → src/data/treks.json   [build-time only, never imported by UI]
```

- `src/lib/*` is **pure and framework-free** where possible (distance, filters), so it is unit
  tested without React.
- Components depend on `lib` and `data`, never the reverse.
- `scripts/*` may use Node APIs and network; `src/*` must run in the browser.

**Runtime network calls (only these, all client-side, all free/no-key):**

| Call               | When                               | Spec |
| ------------------ | ---------------------------------- | ---- |
| Nominatim geocode  | user picks a custom origin         | 03   |
| Overpass discovery | origin has no curated treks        | 03   |
| Open-Meteo weather | trek detail card opened (optional) | 06   |
| Web3Forms POST     | feedback submitted                 | 07   |

## Edge cases & error states

- Any runtime API failure must **never blank the app** — show curated data and an inline notice.
- `treks.json` is always present and valid (CI `validate:data` guarantees it); the app can assume
  a well-formed array.

## Test cases (TDD checklist)

- A lint/import rule (or unit test) asserts `src/components/**` does not import from `scripts/**`.
- A unit test asserts `src/lib/distance` and `src/lib/filters` import no React.
- Smoke test: app renders the default origin with zero mocked network calls.

## Out of scope

- The specifics of each data source (→ 02), the picker behavior (→ 03), styling (→ 08).

## Open questions

- None blocking. (Optional future: a tiny serverless proxy if browser→API CORS/rate limits ever
  bite — explicitly deferred.)

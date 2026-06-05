# Trailward — Specifications

These specs are the **source of truth**. Code is written test-first against them; a spec is
signed off before its module is built. If code and spec disagree, the spec wins (or the spec is
updated deliberately).

## How to read a spec

Every `NN-*.md` follows the same template:

- **Purpose** — why this module exists, in 1–2 sentences.
- **User stories** — who needs what, and why.
- **Acceptance criteria** — Given/When/Then statements that must hold. These become tests.
- **Interfaces & data contracts** — types, function signatures, API request/response shapes.
- **Edge cases & error states** — what happens when things go wrong or are empty.
- **Test cases (TDD checklist)** — the concrete tests to write first.
- **Out of scope** — explicitly not this module's job.
- **Open questions** — decisions still needed from the maintainer.

## Index

| Spec                                              | Module                                        |
| ------------------------------------------------- | --------------------------------------------- |
| [00-architecture](./00-architecture.md)           | System shape, data tiers, dataflow            |
| [01-data-model](./01-data-model.md)               | `Trek` / `Origin` types, validation           |
| [02-data-pipeline](./02-data-pipeline.md)         | Build-time fetch/scrape → `treks.json`        |
| [03-origin-picker](./03-origin-picker.md)         | Dynamic origin, geocoding, discovery          |
| [04-map](./04-map.md)                             | Leaflet map, markers, clustering, radius ring |
| [05-filters](./05-filters.md)                     | Radius slider + filter panel + sync           |
| [06-trek-detail](./06-trek-detail.md)             | Detail card, weather, external links          |
| [07-feedback](./07-feedback.md)                   | Web3Forms feedback + suggest-a-trek           |
| [08-design-system](./08-design-system.md)         | Palette, type scale, components, responsive   |
| [09-hosting-deploy](./09-hosting-deploy.md)       | GitHub Pages, Vite base, gated CI             |
| [10-scheduled-refresh](./10-scheduled-refresh.md) | Weekly cron, commit + redeploy                |

## Glossary

- **Origin** — the center place the radius is measured from. Default: Bengaluru.
- **Curated trek** — a hand-verified record with rich fields (fees, permits, photo, sources).
- **Discovery trek** — a peak surfaced live from OpenStreetMap for origins we haven't curated;
  shown with a "community / unverified" badge and limited fields.
- **Tier** — `curated` or `discovery`, marking a trek's data quality/provenance.
- **Pipeline** — the build-time Node scripts that produce `treks.json`.

## Conventions

- Distances in **km**, elevation in **metres**, durations as human strings (`"2–3 h"`).
- Coordinates are `{ lat, lng }` decimal degrees, WGS84.
- All external calls use free, no-key endpoints and respect each provider's usage policy.

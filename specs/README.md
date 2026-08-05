# Trailward — Specifications

These specs are the **source of truth**. A feature's spec is written (or an existing spec
updated) BEFORE its implementation ships; its Verification section names the tests that prove
it. If code and spec disagree, the spec wins — or the spec is updated deliberately, in the same
PR as the code that diverged.

## The workflow (enforced by the PR loop)

1. **Spec first.** A PR that changes behaviour must create or update a spec in the same PR.
   The `/ship` procedure refuses to open a behaviour-changing PR without a spec delta, and the
   PR template requires linking it.
2. **Tests with the change.** Every behaviour in a spec's Verification section has a test;
   the review loop treats "behaviour change without a test" as a blocking finding. The
   coverage ratchet (vite.config) makes silent test-suite decay a CI failure.
3. **Failure modes get written back.** When an incident teaches something (see specs 26/27/31/32),
   the lesson is recorded in the owning spec in the fixing PR — not in commit messages alone.

## How to read a spec

Original template (specs 00–15): Purpose · User stories · Acceptance criteria · Interfaces &
data contracts · Edge cases & error states · Test cases (TDD checklist) · Out of scope · Open
questions.

Condensed template (specs 16+, adopted deliberately as the feature surface moved from UI
modules to data pipelines): **Purpose** · **Design & interfaces** (per major mechanism) ·
**Edge cases / failure modes** (mandatory whenever an incident taught one) · **Out of scope /
Not done** (decisions against, so they aren't re-litigated) · **Verification** (the tests, unit
→ data → e2e). Both templates share the invariant that matters: every spec ends in a
Verification section whose claims exist as tests.

## Index

| Spec                                                            | Module                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| [00-architecture](./00-architecture.md)                         | System shape, data tiers, dataflow                       |
| [01-data-model](./01-data-model.md)                             | `Trek` / `Origin` types, validation                      |
| [02-data-pipeline](./02-data-pipeline.md)                       | Build-time fetch → `treks.json`                          |
| [03-origin-picker](./03-origin-picker.md)                       | Dynamic origin, geocoding, discovery                     |
| [04-map](./04-map.md)                                           | Leaflet map, markers, clustering, radius ring            |
| [05-filters](./05-filters.md)                                   | Radius slider + filter panel + sync                      |
| [06-trek-detail](./06-trek-detail.md)                           | Detail card, weather, external links                     |
| [07-feedback](./07-feedback.md)                                 | _Superseded by spec 29_ (was Web3Forms)                  |
| [08-design-system](./08-design-system.md)                       | Palette, type scale, components, responsive              |
| [09-hosting-deploy](./09-hosting-deploy.md)                     | GitHub Pages, Vite base, gated CI                        |
| [10-scheduled-refresh](./10-scheduled-refresh.md)               | Weekly cron, commit + redeploy                           |
| [11-topography-discovery](./11-topography-discovery.md)         | OSM peak discovery + terrain scoring                     |
| [12-manual-additions](./12-manual-additions.md)                 | Hand-added peaks the sources miss                        |
| [13-map-layers-location-gpx](./13-map-layers-location-gpx.md)   | Basemaps, geolocation, GPX export                        |
| [14-trails-elevation-profile](./14-trails-elevation-profile.md) | OSM trails + elevation profiles                          |
| [15-polish](./15-polish.md)                                     | Hidden-gem score, badges, UX polish                      |
| [16-geonames-listed-summits](./16-geonames-listed-summits.md)   | GeoNames listed tier (all summits, unscored pins)        |
| [17-tile-dem-scoring](./17-tile-dem-scoring.md)                 | Tile-DEM terrain scoring (quota-free)                    |
| [18-wikidata-crossmatch](./18-wikidata-crossmatch.md)           | Wikidata cross-match: hidden-gem honesty + photos        |
| [19-lazy-enrichment](./19-lazy-enrichment.md)                   | On-open enrichment (Wikipedia/Commons/Nominatim)         |
| [20-climate-best-season](./20-climate-best-season.md)           | Rainfall-derived `bestSeason` (Open-Meteo)               |
| [21-gazetteer-history](./21-gazetteer-history.md)               | 1900s gazetteers → `historicalNote`                      |
| [22-hill-features](./22-hill-features.md)                       | OSM hill features (forts, temples, caves)                |
| [23-wildlife](./23-wildlife.md)                                 | iNaturalist wildlife (lazy)                              |
| [24-protected-heritage](./24-protected-heritage.md)             | Protected-area + heritage flags                          |
| [25-altnames-persistence](./25-altnames-persistence.md)         | Alternate names + cron-preservation of baked fields      |
| [26-landcover](./26-landcover.md)                               | ESA WorldCover ground cover (COG reader)                 |
| [27-peak-detection](./27-peak-detection.md)                     | DEM peak detection (summits no database names)           |
| [28-naming](./28-naming.md)                                     | Naming the unnamed: inference, Maps link, suggest loop   |
| [29-feedback-store](./29-feedback-store.md)                     | Feedback via GitHub Issues + apply-suggestions cron      |
| [30-nationwide](./30-nationwide.md)                             | Region-free records, cell-chunked serving, any-city      |
| [31-extra-sources-and-volume](./31-extra-sources-and-volume.md) | OSM/Wikidata sweep, village rule, UI volume, drift guard |
| [32-data-operations](./32-data-operations.md)                   | Rebake runbook: writer serialization, order, caches      |

## Glossary

- **Origin** — the place the radius is measured from: any geocoded city or a preset
  (spec 30). Nothing is tied to a single city.
- **Curated trek** — a hand-verified record with rich fields (fees, permits, photo, sources).
- **Discovery trek** — a precomputed, nationwide pin from OSM/GeoNames/Wikidata/detection,
  shown with a "community · unverified" or "terrain-detected · unverified" badge.
- **Listed pin** — a discovery trek from a name database (GeoNames `gn-`, OSM sweep `osmx-`,
  Wikidata `wd-`), terrain-scored from tiles when the DEM resolves it.
- **Detected pin** — a discovery trek found by scanning the DEM itself (`d12-`, spec 27);
  named only by inference (spec 28/31) or community suggestion (spec 29).
- **Tier** — `curated` or `discovery`, marking data quality/provenance.
- **Pipeline** — the build-time Node scripts that produce `treks.json` and the served cells
  (`public/data/cells/`); operated per spec 32.

## Conventions

- Distances in **km**, elevation in **metres**, durations as human strings (`"2–3 h"`).
- Coordinates are `{ lat, lng }` decimal degrees, WGS84.
- All external calls use free, no-key endpoints and respect each provider's usage policy;
  fetchers follow the error-path contract in spec 31.
- The app requires **zero env vars**; there is no backend and no database.

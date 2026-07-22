# 12 — Manual peak additions

## Purpose

OpenStreetMap has gaps: real treks like **Puligundu** (a granite rock hill near Chittoor) exist
on Google Maps but are **not tagged** `natural=peak`/`hill` in OSM, so live/precomputed discovery
(which draws only from OSM) can never surface them. Trailforks fills such gaps with user-submitted
trails; our no-backend equivalent is a small, hand-maintained **seed of manual peaks** merged into
the discovery pipeline so they get the same terrain scoring + enrichment as any discovered peak.

## Scope

- A committed list of manually-added summits absent from OSM, each with coordinates.
- Merged into `precomputeRegion` as extra candidates (per region, by radius), so they are
  DEM-scored, ranked, and enriched (photo/summary/town) like OSM candidates.
- Deduped against OSM candidates so a manual peak that later gets mapped isn't shown twice.
- Not a general CMS — just a maintainer-edited TypeScript seed, refreshed by the weekly cron.

## Interfaces & data contracts

```ts
// scripts/seed/manual-peaks.ts
interface ManualPeak {
  id: string;        // stable slug, prefixed "manual-", e.g. "manual-puligundu"
  name: string;
  lat: number;
  lng: number;
  note?: string;     // short description → seeds `highlights` (survives unless an article overrides)
  sourceUrl?: string;// provenance link → the record's `sources[0]`
}
manualPeaksNear(origin: Origin, radiusKm: number): ParsedPeak[]; // in-range, mapped to ParsedPeak

// src/lib/overpass.ts — ParsedPeak gains two optional carry-through fields:
sourceUrl?: string;  // overrides the default OSM-node source link
note?: string;       // seeds highlights

// scripts/discover-precompute.ts
mergeManualPeaks(manual: ParsedPeak[], osm: ParsedPeak[]): ParsedPeak[]; // manual first; drop OSM within 200 m
```

- First entry: **Puligundu** — `13.3417, 79.2032`, note about the granite hill near Chittoor,
  `sourceUrl` an OpenStreetMap coordinate view. Falls in the Bengaluru region (~78 km), so it
  rides the Bengaluru 500 km precompute and ends up `cityId: "bangalore"`, `tier: "discovery"`.

## Edge cases

- Manual peak already in OSM (within 200 m of an OSM candidate) → the OSM duplicate is dropped;
  the manual entry (with its note/source) wins.
- Manual peak with no DEM signal → same handling as any candidate (low confidence, ranks low).
- No manual peaks in a region → pipeline unchanged.

## Test cases (TDD)

- `mergeManualPeaks`: manual entry kept; an OSM peak within 200 m removed; distant OSM kept.
- `manualPeaksNear`: returns only entries within radius, mapped to `ParsedPeak` with
  `sourceUrl`/`note` carried.
- `precomputeRegion` (injected fetchers): a manual candidate becomes a discovery Trek with the
  seeded `sources[0]` = its `sourceUrl` and `highlights` = its `note` (when no nearby article).

## Out of scope

- User-facing submission UI (needs a backend). Editing the seed is a maintainer/PR action.

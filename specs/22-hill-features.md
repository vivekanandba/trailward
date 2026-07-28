# 22 — Hill features (what's ON the summit)

## Purpose

A fort, a summit temple, or a cave is often the actual reason to pick one South Indian hill over
another — and OSM usually has them. Until now we only recorded _trailhead_ POIs (parking, water,
viewpoint), which say nothing about what you find at the top.

## Design

`hillFeatures?: HillFeature[]` where `HillFeature = "fort" | "temple" | "cave" | "ruins"`.

**Deliberately excludes viewpoint and water.** Those come from the wider 1,500 m trailhead-POI
query and are already reported as `pois` _with a distance_. Including them here would both
double-report and overstate proximity — a viewpoint 1.4 km away is not "on the hill".

- Summit features use a tight **600 m** radius, so a temple in the village below isn't credited to
  the summit.
- The query matches **nodes, ways and relations** (`nwr`): forts and temple compounds are mapped as
  areas and therefore have no lat/lon of their own — a node-only parse silently misses most forts.
- `parseHillFeatures` (pure, tested) dedupes and returns a **stable order**, so rebuilds don't churn
  the JSON diff.

## Where it runs

1. Folded into the existing combined Overpass call in `fetchTrailAndPois` — **no extra request** for
   peaks the weekly pipeline already fetches trails for.
2. `scripts/build-hillfeatures.ts` (hand-run, `npm run build:hillfeatures`) backfills the rest
   without a full rebuild: every curated trek (the famous forts had no trail record, so they were
   missed entirely), everything already carrying a trail/POIs, and the top 25 discovery peaks per
   region. One throttled Overpass call each; it only clears a stale value for summits it actually
   re-queried.

## Presentation

Rendered as chips beside the difficulty badge in the detail panel (`Fort`, `Temple`, `Cave`,
`Ruins`), titled "Mapped on the summit in OpenStreetMap" so the provenance is clear.

## Verification

Unit tests: detection across nodes/ways/relations (incl. an area-mapped fort with no lat/lon),
dedupe + stable ordering, explicit assertion that **trailhead POIs are ignored**, and junk-input
tolerance. No network.

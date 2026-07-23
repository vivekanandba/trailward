# 15 — Polish: trailhead POIs, photo gallery, region stats, filters + legend

## Purpose

Four Trailforks-style finishing touches, free-data + no-backend as always. Two touch the
build data (folded into existing fetchers so they add ~no API cost); two are client-only.

## A. Nearby trailhead POIs (data)

For the top peaks that already get a trail (`trailLimit`), the trail Overpass call also returns
nearby **parking / drinking water / viewpoint**, so no extra request.

- One combined query per top peak: paths (`out geom`) + POI nodes
  (`amenity=parking|drinking_water`, `natural=spring`, `tourism=viewpoint`) within ~1.5 km.
- Keep the **nearest of each kind**; store `pois?: { kind: "parking"|"water"|"viewpoint";
lat: number; lng: number; distM: number }[]` on the Trek (validated). Detail shows Facts
  ("Parking · ~800 m", "Water · ~1.2 km", "Viewpoint · ~400 m").

## B. Photo gallery (data)

Commons geosearch already returns several files; fetch imageinfo for up to **3** in one
multi-title request (no extra call) → `gallery?: TrekImage[]`. Detail renders the hero plus a
small thumbnail strip when `gallery.length > 1`.

## C. Region overview stats (client-only)

A compact card in the list rail summarising the current origin's peaks (from `visible`):
count, difficulty spread (Easy/Moderate/Hard incl. estimated), highest elevation, most-rugged
(max relief), top hidden-gem. Difficulty spread as a tiny stacked bar (follow `dataviz`).

## D. Filters + map legend (client-only)

- `filters.ts`/`FilterBar.tsx`: a **"Hidden gems only"** toggle (`discoveryScore ≥ 0.7`) and a
  **min-relief** slider (rugged filter, applies to any peak with `reliefM`).
- `TrekMap.tsx`: a small **legend** overlay (bottom-left) — difficulty colours + the dashed
  "unverified/discovery" style.

## Interfaces & data contracts

```ts
// src/lib/trek.ts
pois?: { kind: "parking" | "water" | "viewpoint"; lat: number; lng: number; distM: number }[];
gallery?: TrekImage[];

// scripts/sources/trails.ts — trail fetch also returns nearest POIs
parsePois(json, summit): TrailPoi[];             // nodes → nearest per kind
fetchTrailAndPois(summit, fetchElev): Promise<{ trail?; pois? }>;

// scripts/sources/commons.ts
fetchNearbyPhotos(lat, lng, radiusM, limit=3): Promise<TrekImage[]>;  // geosearch + 1 multi imageinfo

// src/lib/filters.ts — FilterState gains:
hiddenGemsOnly: boolean;   // discoveryScore >= 0.7
minReliefM?: number;       // keep peaks with reliefM >= this (excludes unknown-relief when set)
```

## Test cases (TDD)

- `parsePois`: nodes → nearest parking/water/viewpoint, one per kind, with distM.
- `parseCommonsImages` (multi): imageinfo with N pages → N TrekImages.
- `filters`: `hiddenGemsOnly` keeps only high-score discovery peaks; `minReliefM` excludes
  low/unknown-relief peaks only when set; defaults keep everything.
- `trek`: `pois`/`gallery` validate (kind enum, distM ≥ 0, image attribution).
- Region-stats aggregate helper (pure): counts + spread + max relief from a trek list.
- e2e: hidden-gems toggle narrows the list; legend visible; a peak with POIs shows them.

## Out of scope

- Routing between POIs; user-submitted photos/POIs (backend).

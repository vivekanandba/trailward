# 14 — Trail paths & elevation profile

## Purpose

Turn a discovery pin into a **trail**: draw the nearest OpenStreetMap walking path to a
summit, show its **length** and **elevation gain**, and an **elevation profile** — the core
of what makes Trailforks useful. Build-time + free data only (Overpass geometry + DEM).

## Scope

- For the **top-ranked** discovery peaks per region (a small `trailLimit`, plus manual peaks),
  find the nearest OSM path and attach a `trail` (polyline + length + gain + per-vertex
  elevations). Bounded to the top peaks because each trail is an extra Overpass + DEM call.
- A peak with no mapped path nearby simply has no `trail` (best-effort, never fails a region).

## Mechanism

1. **Ways** — Overpass `way(around:1200,lat,lng)[highway~"^(path|footway|track|steps)$"];out geom;`
   (best-effort; failure → no trail).
2. **Pick** — the way whose nearest vertex is closest to the summit, within ~250 m (else none).
3. **Simplify** — downsample to ≤ `MAX_TRAIL_POINTS` (30) vertices to bound JSON size.
4. **Measure** — `lengthKm` = haversine sum over vertices; sample vertex elevations via
   `fetchElevations` (Open-Meteo → OpenTopoData failover); `gainM` = Σ positive deltas;
   `profile` = per-vertex elevation (for the chart).

## Interfaces & data contracts

```ts
// src/lib/trek.ts — trail gains an optional profile:
trail?: { coords: [number, number][]; lengthKm: number; gainM: number; profile?: number[] };

// scripts/sources/trails.ts (pure + one fetch)
parseTrailWays(json: unknown): [number, number][][];          // ways → polylines
pickNearestTrail(ways, summit, maxM=250): [number,number][] | undefined;
simplifyPath(coords, maxPoints): [number, number][];
pathLengthKm(coords): number;
fetchTrail(summit, fetchElev): Promise<Trek["trail"] | undefined>;  // best-effort

// scripts/discover-precompute.ts
DiscoverFetchers.trail?(peak): Promise<Trek["trail"] | undefined>;  // called for top `trailLimit` + manual
RegionConfig.trailLimit: number;  // Bengaluru 40, others 20
```

## UI

- `TrekMap.tsx`: when a trek with a `trail` is selected, draw its `coords` as a `Polyline`
  above the pins (trail-green, rounded).
- `TrekDetail.tsx`: `Fact` rows "Trail length" (~X km) and "Elevation gain" (~Y m), and a small
  **inline SVG elevation profile** (x = cumulative distance, y = profile elevation) — dependency-
  free; follow the `dataviz` skill for colour/scale. Shown only when `trail.profile` exists.
- GPX (spec 13) already serialises `trail.coords` as a `<trk>`.

## Edge cases

- No path within 250 m → no trail (most peaks). Path with < 2 usable elevations → no `profile`
  (still show length/gain if computable). Flat trail → gain 0.

## Test cases (TDD)

- `parseTrailWays`: ways with `geometry` → polylines; malformed dropped.
- `pickNearestTrail`: picks the closest way; returns undefined beyond `maxM`.
- `simplifyPath`: never exceeds maxPoints; keeps first/last.
- `pathLengthKm`: matches a hand-computed multi-segment length.
- `precomputeRegion`: a peak with an injected trail fetcher gains a valid `trail`; validation
  accepts it; GPX emits a `<trk>`.

## Out of scope

- Routing/turn-by-turn; choosing among multiple trails; trail difficulty grading.

# 04 — Map

## Purpose

Render the treks on an interactive Leaflet map centered on the active origin, with a radius ring,
difficulty-coded markers, and clustering, as the spatial heart of the app.

## User stories

- As a **visitor**, I want to see at a glance where treks are relative to my origin and how far.
- As a **visitor**, I want to tell difficulty apart without clicking (color), and not be
  overwhelmed by overlapping pins when zoomed out.

## Acceptance criteria

- **Given** an origin and a set of treks, **when** the map renders, **then** it is centered on the
  origin with a marker for the origin and one marker per visible trek.
- **Given** the radius is R km, **when** rendered, **then** a circle of radius R is drawn from the
  origin and the initial zoom roughly fits that circle.
- **Given** trek difficulty, **when** markers render, **then** color encodes difficulty
  (Easy/Moderate/Hard) and discovery-tier pins are visually distinct (e.g. hollow/grey).
- **Given** many markers at low zoom, **when** rendered, **then** nearby markers cluster; zooming
  in expands them.
- **Given** a marker is clicked, **then** it selects that trek (opens detail, → 06) and a popup
  shows name + key stats.
- **Given** Leaflet default marker images, **when** built for GitHub Pages, **then** icons resolve
  correctly under the `/trailward/` base (no broken-image markers).

## Interfaces & data contracts

```ts
// src/components/TrekMap.tsx
interface TrekMapProps {
  origin: Origin;
  radiusKm: number;
  treks: Trek[]; // already filtered (→ 05)
  selectedId?: string;
  onSelect(id: string): void;
}
// src/lib/icons.ts
markerIcon(difficulty?: Difficulty, tier?: Tier): L.Icon | L.DivIcon;
```

- Tiles: **CARTO Voyager** (free, no token), with required attribution shown.
- Clustering via `leaflet.markercluster` (or `react-leaflet-cluster`).

## Edge cases & error states

- Zero treks → map still renders origin + ring + "no treks match" affordance (from 05/03).
- Tile load failure → Leaflet shows grey tiles; app remains usable (attribution + markers).
- Origin change → map recenters smoothly and ring updates (no full remount flicker).

## Test cases (TDD checklist)

- Renders origin marker + N trek markers for an N-item fixture (RTL + mocked Leaflet or jsdom).
- `markerIcon` returns distinct icons per difficulty and a distinct style for `discovery`.
- Clicking a marker calls `onSelect` with the right id.
- Radius prop change updates the circle radius.
- E2E (Playwright): default load shows the ring and clustered pins; zoom-in declusters.

## Out of scope

- Which treks are visible (→ 05 filters). The detail card contents (→ 06).

## Open questions

- Marker style: pin vs. circle-marker with difficulty color — finalize with 08 (design system).

# 05 — Filters & Radius Slider

## Purpose

Let users narrow treks to exactly what they want — within a chosen radius and matching difficulty,
elevation, type, and other constraints — with the map, list, and count always in sync.

## User stories

- As a **beginner**, I want only Easy treks within 60 km.
- As a **peak-bagger**, I want treks above 1,200 m regardless of type.
- As a **night trekker**, I want only treks that allow night treks.
- As **anyone**, I want one control to widen/narrow the search radius and see results update live.

## Acceptance criteria

- **Given** the radius slider (10–150 km), **when** dragged, **then** the map ring, the visible
  pins, and the result count all update to treks whose distance ≤ radius.
- **Given** multiple filters set, **when** applied, **then** results satisfy **all** of them
  (logical AND), and the visible count reflects the intersection.
- **Given** the elevation dual-slider [min,max], **when** set, **then** only treks with
  `elevationM` in range show; treks lacking elevation are excluded only if an elevation filter is
  active (documented behavior).
- **Given** any filter state, **when** "Reset" is clicked, **then** all filters return to defaults
  (radius to its default, others cleared) and full results show.
- **Given** filters that match nothing, **then** the UI shows an explicit empty state, not a blank
  map.

## Interfaces & data contracts

```ts
export interface FilterState {
  radiusKm: number; // default 100
  difficulties: Difficulty[]; // empty = all
  elevation?: [number, number];
  trailLengthMaxKm?: number;
  durationMaxHrs?: number;
  types: TrekType[]; // empty = all
  nightOnly: boolean;
  permitRequired?: boolean; // undefined = any
  query: string; // free-text on name/town
}

export const DEFAULT_FILTERS: FilterState;

// Pure, framework-free — the testable core.
export function applyFilters(treks: Trek[], origin: Origin, f: FilterState): Trek[];
export function countByDifficulty(treks: Trek[]): Record<Difficulty, number>;
```

- `applyFilters` uses `distanceFrom(origin, trek)` (haversine in `src/lib/distance.ts`) when a
  trek lacks a precomputed `distanceKm`.

## Edge cases & error states

- Filters that exclude all treks → empty state with a "clear filters" shortcut.
- Free-text query is case/diacritic-insensitive and trims whitespace.
- Discovery treks often lack `difficulty`/`type`; document that type/difficulty filters exclude
  unknowns only when that filter is active (so "show all" still shows them).
- Radius below nearest trek distance → empty, with hint to widen.

## Test cases (TDD checklist)

- `applyFilters` AND-composition: radius + difficulty + nightOnly returns only matching set.
- Radius boundary: trek exactly at R is included; R−ε excludes it.
- Elevation range inclusive bounds; unknown-elevation handling matches the documented rule.
- Free-text matches name and `nearestTown`, case-insensitive.
- `DEFAULT_FILTERS` returns the full set; Reset restores defaults.
- Component test: moving the slider updates count + list; map receives filtered treks.

## Out of scope

- Rendering markers (→ 04). Detail card (→ 06).

## Open questions

- Default radius: 100 km (matches the original "100 km around Bangalore" ask) — confirm.

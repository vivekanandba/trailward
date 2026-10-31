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

- Distance from the origin is `tripDistance(origin, trek)` (`src/lib/distance.ts`), used by the
  filter, the map tooltip and the detail panel alike. A curated trek's baked `distanceKm` and
  `driveTimeMin` are the OSRM route **from Bengaluru's centre** (`ROAD_ORIGIN`, spec 02), so they
  are used only when the origin is that point (within 50 m). From any other origin, including a
  live location a few hundred metres away, the distance is the straight line (haversine), and
  it is labelled as such.
- The detail panel says which it is: `~68 km by road · 1 h 16 min drive`, or `~176 km in a
straight line` (`formatTrip`). The map tooltip appends "by road" only to a road distance.

## Edge cases & error states

- Filters that exclude all treks → empty state with a "clear filters" shortcut.
- Free-text query is case/diacritic-insensitive and trims whitespace.
- Discovery treks often lack `difficulty`/`type`; document that type/difficulty filters exclude
  unknowns only when that filter is active (so "show all" still shows them).
- Radius below nearest trek distance → empty, with hint to widen.
- **Defect fixed (spec 44 register row 16):** every curated trek reported its road distance
  from Bengaluru whatever the origin, in the filter, the tooltip and the detail. From Mysuru,
  Skandagiri was listed at 67.6 km and passed a 100 km radius; it is ~176 km away.

## Test cases (TDD checklist)

- `applyFilters` AND-composition: radius + difficulty + nightOnly returns only matching set.
- Radius boundary: trek exactly at R is included; R−ε excludes it.
- Elevation range inclusive bounds; unknown-elevation handling matches the documented rule.
- Free-text matches name and `nearestTown`, case-insensitive.
- `src/lib/distance.test.ts` → `tripDistance`: road distance and drive time from Bengaluru; the
  straight line from another origin and from a live location ~350 m away; the straight line when
  nothing was measured. `formatTrip`: each label form.
- `src/lib/filters.test.ts`: from Mysuru, Bengaluru's road distance does not admit Skandagiri.
- `src/components/TrekDetail.test.tsx`: "by road · … drive" from Bengaluru, "in a straight line"
  and no drive time from Mysuru.
- `DEFAULT_FILTERS` returns the full set; Reset restores defaults.
- Component test: moving the slider updates count + list; map receives filtered treks.

## Out of scope

- Rendering markers (→ 04). Detail card (→ 06).

## Open questions

- Default radius: 100 km (matches the original "100 km around Bangalore" ask) — confirm.

# 06 — Trek Detail

## Purpose

Show everything needed to plan a trek when one is selected: the facts, a photo, optional live
weather, directions, and the sources behind the data.

## User stories

- As a **planner**, I want distance, difficulty, elevation, duration, best season, permit/fee, and
  a directions link in one place.
- As a **skeptic**, I want to see where the data came from and whether it's verified.
- As a **day-tripper**, I want current weather at the trek before I commit.

## Acceptance criteria

- **Given** a selected trek, **when** the detail opens, **then** it shows name, type badges,
  difficulty, distance + drive time from the **current origin**, elevation, trail length/duration,
  best season, permit + fee, night-trek flag, highlights, nearest town.
- **Given** a curated trek with an image, **when** shown, **then** the photo renders **with its
  attribution** visible.
- **Given** a trek, **when** shown, **then** a "Directions" link opens Google Maps routing from
  the origin to the trek coordinates, and a "Sources" list links each source URL.
- **Given** a discovery trek, **when** shown, **then** a "community / unverified" badge is present
  and absent fields are gracefully omitted (no empty rows).
- **Given** the detail is open, **when** weather is available, **then** current conditions + a
  short outlook show; **when** the weather call fails, **then** the rest of the card is unaffected.

## Interfaces & data contracts

```ts
// src/components/TrekDetail.tsx
interface TrekDetailProps {
  trek: Trek;
  origin: Origin;
  onClose(): void;
}
// src/lib/weather.ts (Open-Meteo, runtime, optional)
getWeather(lat: number, lng: number): Promise<WeatherNow>; // { tempC, code, summary, next3d }
// directions helper
googleMapsDirectionsUrl(origin: Origin, trek: Trek): string;
```

## Edge cases & error states

- Image URL 404 → hide the image block, keep attribution out (no broken image).
- Weather unavailable/slow → card renders immediately; weather fills in or shows "unavailable".
- Missing optional fields → omit their rows entirely rather than showing "—" clutter (consistent
  rule, tested).

## Test cases (TDD checklist)

- Renders all present fields from a curated fixture; omits rows for absent fields.
- Shows attribution whenever an image is shown; never shows an image without attribution.
- `googleMapsDirectionsUrl` produces a valid maps URL with origin + destination coords.
- Discovery fixture shows the unverified badge.
- Weather: success fills conditions; mocked failure leaves the card intact (no throw).

## Out of scope

- Selecting a trek (→ 04 map / 05 list). Fetching photos at build (→ 02).

## Open questions

- Show a 3-day outlook or just "current + today"? (Lean: current + 3-day mini-row.)

# 20 — Climate-derived best season

## Purpose

Rainfall decides when a South Indian hill is actually pleasant to climb, and most discovery peaks
had no season guidance at all. This derives each peak's **driest stretch** from real mean monthly
rainfall (Open-Meteo archive, free/no key) instead of guessing — and shows the rainfall profile so
the claim is visible rather than asserted.

## A. Coarse-grid sampling (the cost trick)

Climate varies slowly over space, so rainfall is sampled per **0.25° grid cell (~28 km)**, not per
peak: **542 cells cover all 7,836 treks**. Open-Meteo also accepts many coordinates per request, so
the whole set costs ~55 batched calls.

Its rate limit is **per-minute and weighted by locations × days**, which shaped three decisions:

- `BATCH = 10` locations/request and a 12 s throttle (≈5 requests/min).
- **2 years** (2022–23) — monsoon timing is very stable in South India; a shorter window costs less.
- `http.ts` now treats **429 as retryable** with a ~65 s backoff (it previously fell into the
  non-retryable 4xx path, so rate limits aborted instead of waiting out the window).

`build-climate.ts` is **resumable**: cells already in `climate.json` are skipped, so it can be
re-run across rate-limit windows until coverage completes. It refuses to write when it has nothing.

## B. Storage

`src/data/climate.json` maps **cell key → 12 monthly means** (38 KB raw / **15 KB gzipped**) — stored
once per cell rather than duplicating 12 numbers onto 7,836 treks. `bestSeason` (a short string) is
baked onto the treks themselves.

Curated treks keep their hand-written `bestSeason`; auto-derived ones are **always recomputed**, so
improving the sample and re-running actually refreshes them.

## C. Logic (`src/lib/climate.ts`, pure + client-usable)

- `climateCellKey(lat, lng)` — grid key, shared by build and UI.
- `driestMonths(monthly)` — longest run of months below `max(25 mm, half the local mean)`,
  **wrapping Dec→Jan**. All-dry → year-round; none → no clear season.
- `bestSeasonFrom(monthly)` → `"Dec–Apr (driest)"` — phrased as an observation about rainfall, not a
  promise about conditions (April is dry _and_ punishingly hot; curated guidance may differ, which
  is why curated values win).
- `wettestMonth(monthly)` → the "avoid" hint.

## D. UI

A **Rainfall** panel in `TrekDetail` (styled like the Terrain panel) shows a 12-bar micro-chart with
the wettest month called out. One measure, one hue; the driest stretch is marked by a **shaded band
behind the bars**, not by bar colour — dry months are _short_ bars, so colouring them would hide
exactly what the chart points at (the first attempt did, and was fixed after looking at it). Dry
month labels are additionally bolded, the season is stated in text above, and the full series is in
the `aria-label`, so nothing rests on colour alone. Verified in light and dark.

## Verification

- Unit: `climate.ts` (cell keying, dry-run detection incl. Dec→Jan wrap, arid + malformed input,
  formatting, wettest month) against **real sampled profiles**; `sources/climate.ts` (daily→monthly
  aggregation, multi-location batching, per-batch failure isolation). No network.
- Component: rainfall panel renders for a covered coordinate and is omitted where no cell exists.
- Data: `npm run build:climate` → 542/542 cells, `bestSeason` on 7,836/7,836 treks;
  `validate:data` passes; re-run is idempotent and needs no network.

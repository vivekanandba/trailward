# 11 — Topography-aware discovery

## Purpose

Make live-discovered peaks **useful** instead of a flat, elevation-sorted list. For the
non-curated **preset** regions we sample a terrain profile around each peak from a free
DEM, compute how rugged/scenic it is, cross-reference how _undocumented_ it is, and rank
so that **rugged + scenic + lesser-known peaks rise to the top** — surfacing hidden gems
rather than the tallest or most famous. We also **estimate a difficulty** from the terrain
so a discovered peak reads "est. Moderate · ~420 m relief" instead of bare "Unverified".

All data stays **free / no-key** (Overpass, Open-Meteo DEM, Wikipedia GeoSearch),
consistent with the no-backend architecture (→ 00, 02).

## Scope

- **Precompute-only.** Topography-aware discovery is computed at **build time** for the
  preset regions (Pune, Mumbai, Hyderabad, Chikmagalur, **and Bengaluru**) and baked into
  `src/data/treks.json`, refreshed by the weekly cron (→ 10).
- **Supplement, don't replace, curated.** For Bengaluru the ranked discovery peaks are
  shown **alongside** the 16 curated treks (deduped against them within
  `CURATED_DEDUP_KM`), so a local finds lesser-known peaks beyond the famous ones. The
  banner reads "Plus N lesser-known peaks…"; curated treks keep precedence and their
  verified badge. Curated treks are **also given terrain** (relief/slope/prominence) so
  known and unknown peaks are described in the same objective terms — without altering
  their curated difficulty or verified status.
- **Per-region reach + depth** (`configFor`). Bengaluru is the home region: discovery
  reaches **500 km** and keeps the top **80** by score (its radius slider goes to 500);
  other regions stay at 150 km / top 40.
- **Enrichment.** The kept (top-N) discovery peaks get, best-effort: a nearby CC-licensed
  **Wikimedia Commons photo** (with attribution), a short **summary** when a Wikipedia
  article sits within ~800 m, and the **nearest town** (Nominatim reverse geocode). Any
  step that finds nothing is simply omitted — truly-unknown peaks get fewer of these.
- **Summits: `natural=peak` + `natural=hill`** — many South-Indian hills (bettas, gundus,
  kondas) are tagged `hill`, so peaks-only missed the Eastern-Ghats/Deccan ranges near
  Vellore/Chittoor. Other classes (waterfalls, caves, forts) remain out of scope.
- **Score every candidate, keep them all — filters do the capping.** No elevation
  pre-filter and no top-N: every summit within radius is DEM-scored and kept (up to a high
  safety ceiling that only warns). The UI radius/difficulty/type/elevation filters narrow
  the view. Only the expensive photo/summary/town enrichment is bounded to the top
  `enrichLimit` by score (the long tail still ships terrain + score). Bengaluru at 500 km
  yields ~1,100+ peaks.
- **Map viewport culling** keeps this cheap to render: `TrekMap` draws only markers within
  the current (padded) view, so an uncapped set costs only what's on screen — clustering
  still collapses dense zoomed-out views.
- **Arbitrary typed origins are unchanged**: they keep the existing live `discoverPeaks`
  (elevation-sorted) as a graceful fallback (→ 03).

## Mechanism

1. **Candidates** — Overpass `node(around:R,lat,lng)[natural=peak];out;` (reuse
   `parsePeaks`, extended to also read `tags.wikipedia` / `tags.wikidata` /
   `tags["name:en"]` and an opportunistic `tags.prominence`). Keep the top ~60 by `ele`
   before DEM sampling to bound API calls.
2. **Terrain profile** — for each candidate sample a **9-point rosette**: the summit plus
   8 compass points at **r = 450 m** (≈ 5 cells of the 90 m DEM). Elevations come from
   Open-Meteo (Copernicus GLO-90), batched ≤ 100 coords/request.
   Meter→degree per candidate at its latitude: `dLat = m/111320`,
   `dLng = m/(111320·cos φ)`; ring point at bearing θ =
   `(lat + dLat·cos θ, lng + dLng·sin θ)`.
3. **Metrics** (`src/lib/terrain.ts`, pure):
   - `reliefM = max − min` over the 9 samples.
   - `prominenceProxyM = max(0, centerElev − min(ringElevs))` — a _local_ drop, not true
     watershed prominence (which has no free no-key source; see Risks).
   - `meanSlopeDeg` / `maxSlopeDeg` = `atan(|centerElev − ringElev| / r)` per ring point.
   - `tri` = `sqrt(Σ(ringElev_i − centerElev)²)` (Riley Terrain Ruggedness Index).
   - `confidence = clamp((reliefM − 20) / 80, 0, 1)` — near 0 below ~20 m relief (90 m-DEM
     noise floor), 1 by ~100 m; also 0 when the center or < 3 ring samples are missing.
4. **Obscurity signals** — `hasWikipediaTag` / `hasWikidataTag` (OSM) and
   `nearbyAmenityCount` (a light second Overpass count within ~1 km). Scored from these
   alone (`wikiArticlesWithin1km` is passed `-1`/neutral) to avoid a per-candidate network
   call; the nearby-article check now lives in enrichment for the kept peaks only.
5. **Score** (`src/lib/discoveryScore.ts`, pure) — `score = 0.6·topo + 0.4·obscurity`:
   - `topo` uses **band functions** (adventurous-but-feasible): `relief` sweet-spot
     200–800 m, `prominenceProxy` 120–500 m, `meanSlope` 15–35°, each 0 outside a wide
     outer bound — so dangerously steep _and_ flat both score low. Weighted
     0.4/0.4/0.2, then scaled by `(0.5 + 0.5·confidence)`.
   - `obscurity = 0.4·noWikiTag + 0.3·lowAmenity + 0.3·noNearbyArticle`.
   - Rank by `score` desc, `elevationM` as tiebreaker. **No silent cap** — log candidates
     found vs kept and surface truncation in the banner (as → 03).
6. **Estimated difficulty** (`estimateDifficulty` in `terrain.ts`) — relief + mean slope →
   `Easy | Moderate | Hard`. Stored as **`estimatedDifficulty`**, distinct from the
   curated `difficulty`, to preserve the honest "unverified" distinction.

## Interfaces & data contracts

```ts
// src/lib/terrain.ts
interface LatLng { lat: number; lng: number }
interface TerrainMetrics {
  reliefM: number; prominenceProxyM: number;
  meanSlopeDeg: number; maxSlopeDeg: number;
  tri: number; confidence: number; // confidence in [0,1]
}
rosetteRing(center: LatLng, radiusM: number): LatLng[]; // 8 compass points, each radiusM away
computeTerrain(centerElev: number | undefined, ringElevs: (number | undefined)[], radiusM: number): TerrainMetrics;
estimateDifficulty(m: Pick<TerrainMetrics,"reliefM"|"meanSlopeDeg">): Difficulty;

// src/lib/discoveryScore.ts
band(x: number, lo: number, a: number, b: number, hi: number): number; // trapezoid in [0,1]
scoreDiscovery(t: TerrainInput, o: ObscuritySignals, w?: ScoreWeights): { score; topoScore; obscurityScore };

// src/lib/trek.ts — new optional Trek fields (all forward-compatible, validated by range)
reliefM?, prominenceProxyM?, meanSlopeDeg?, terrainConfidence?, discoveryScore?: number;
estimatedDifficulty?: Difficulty;
```

## Edge cases & error states

- Peak with no OSM `ele` and DEM sample missing → `elevationM` unset; terrain confidence 0;
  ranks low. Never crashes.
- All ring samples equal (flat) → relief/slope/prominence 0 → topo 0 → filtered to bottom.
- A region's Overpass or Open-Meteo call fails at build time → **skip that region**
  (leave its prior baked records untouched); never write a partial/empty region silently.
- 90 m DEM under-resolves small hills → the `confidence` discount keeps low-confidence
  knolls from ranking as gems.

## Test cases (TDD checklist)

- `terrain`: relief/prominence/slope/TRI/confidence against hand-computed fixtures; missing
  center or sparse ring → confidence 0; `estimateDifficulty` thresholds.
- `discoveryScore`: `band` at each breakpoint; flat vs sweet-spot vs extreme terrain;
  obscurity from tag/amenity/article combinations; confidence scaling.
- `overpass`: `parsePeaks` still returns coords+elevation AND now captures wiki/wikidata/
  name:en/prominence; `discoverPeaks` live output unchanged (no leaked terrain fields).
- `filters`: difficulty filter matches a discovery trek via `estimatedDifficulty`.
- `trek`: new fields validate ranges; out-of-range rejected; unknown fields still ignored.
- `discover-precompute` core: with injected fake fetchers (no network) → ranked,
  scored discovery treks; a failing region is skipped, not emptied.

## Out of scope

- Live topography for arbitrary typed origins (→ 03 fallback stays as-is).
- Non-peak feature classes; true watershed prominence; routing/trail-length from DEM.

## Open questions

- Tune band breakpoints & weights against real regional output before locking.
- Whether to later expose a "hidden gems only" filter toggle keyed on `discoveryScore`.

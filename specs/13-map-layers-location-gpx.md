# 13 — Terrain basemap, "use my location", GPX export

## Purpose

Three Trailforks-style, **client-only** upgrades (no pipeline/data change):

1. **Terrain basemap** — a topographic map option (contours + hillshade) alongside the current
   street map, so the landscape reads the way a trekker expects.
2. **"Use my location"** — set the origin to the visitor's GPS position for instant "peaks near
   me", no typing.
3. **GPX export** — download a peak as a GPX waypoint for any phone/GPS app.

All use only free/no-key sources and the browser; nothing hits the build pipeline.

## Interfaces & data contracts

```ts
// src/lib/basemap.ts (mirror src/lib/theme.ts persistence)
type Basemap = "map" | "terrain";
loadBasemap(): Basemap;      // localStorage "trailward:basemap", default "map"
saveBasemap(b: Basemap): void;

// src/lib/gpx.ts (pure)
toGpx(trek: Trek): string;   // GPX 1.1 XML; a <wpt> for the summit (name, ele if known),
                             // and a <trk> when trek.trail exists (forward-compat, Phase C)
```

- **Terrain tiles:** OpenTopoMap `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` (subdomains
  a/b/c, maxZoom 17), attribution "© OpenTopoMap (CC-BY-SA)". Light-use tile policy — fine for
  static GitHub Pages traffic. When basemap = "map", keep the theme-based CARTO light/dark.
- **Geolocation:** `navigator.geolocation.getCurrentPosition`; on success
  `onPick({ id: "geo:<lat>,<lng>", name: "My location", lat, lng })` — reuses the existing
  arbitrary-origin path (live `discoverPeaks`, elevation-sorted; near-me peaks aren't
  topo-scored, that's precompute-only). Handle denied/unavailable/timeout inline.

## UI

- `TrekMap.tsx`: a small map/terrain toggle overlaid on the map (top-right, clear of the
  top-left zoom control), styled to match; choice persisted via `lib/basemap.ts`.
- `OriginSearch.tsx`: a "📍 Use my location" button by the search input; disabled while locating;
  inline error text on failure.
- `TrekDetail.tsx`: a "Download GPX" button (Blob + object URL, `application/gpx+xml`,
  filename `<slug>.gpx`).

## Edge cases

- Geolocation denied / unsupported / times out → inline notice, origin unchanged.
- GPX for a peak with no elevation → omit `<ele>`.
- Terrain tiles fail to load → Leaflet shows blank tiles (same as any tile source); toggling
  back to "map" recovers. No crash.

## Test cases (TDD)

- `gpx.toGpx`: valid GPX 1.1 with a `<wpt>` at the coords; `<ele>` present only when
  `elevationM` set; XML-escapes the name; includes a `<trk>` when `trail` present.
- `basemap.load/saveBasemap`: round-trips; defaults to "map" on empty/invalid/no-storage.
- e2e: toggle to Terrain (OpenTopoMap tiles load); mock geolocation → origin becomes "My
  location"; click Download GPX → a download is triggered.

## Out of scope

- Offline tile caching beyond the existing PWA shell; satellite imagery (no clean free source).

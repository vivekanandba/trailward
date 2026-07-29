# 27 — Terrain-detected summits (DEM peak detection)

## Purpose

Every source so far — OSM, GeoNames, Wikidata, five gazetteer series — only knows **named**
places, and users keep climbing hills none of them list (Puligundu was the first proven case).
The DEM has no such blind spot: this feature scans the elevation tiles **themselves** for
summits, so a hill qualifies by _being a hill_, not by someone having written it down.

## Detection (`scripts/sources/peakdetect.ts`, pure over an elevation grid)

Per region, every pixel of every z12 Terrarium tile (~37 m/px) within the radius:

1. **Local maximum** — ≥ all 8 neighbours, > at least one (exact-tie plateaus emit one summit).
2. **Non-maximum suppression** — must be the highest within ~600 m, so a massif yields one
   candidate, not a ridge of pixels.
3. **Local relief** — drop to the lowest ground within ~1 km (16 spokes × 2 radii). This is the
   user-facing tiering: **≥ 150 m → "Unnamed peak"**, **80–150 m → "Unnamed hill"**.

The tile-backed grid (`createTileGrid`) decodes to Int16 rows behind a bounded LRU — a region is
thousands of tiles, far too many to hold. Zero API quota: Terrarium tiles are unlimited and
disk-cached (`scripts/.cache/demtiles12`). Verified on ground truth before scaling: the strongest
candidate in the Savandurga area is Savandurga itself (elev 1217, relief 374).

## Qualification & scoring (`scripts/build-detect.ts`, hand-run)

- Candidates within **400 m of ANY existing pin are dropped** — named sources always win; what
  survives is, by construction, absent from every database.
- Survivors get the standard offline terrain scoring (rosette relief/slope/prominence, hidden-gem
  score at maximal obscurity, estimated difficulty) from the same tiles.
- `--calibrate` prints per-threshold counts before anything is written, so volume is a measured
  decision, not a guess.
- Output: committed `scripts/detected/india-detected.json` with **stable ids**
  (`d12-<tile>-<pixel>`), so the weekly cron regenerates deterministically.

## Pipeline & UI

- `toDetectedTreks` merges them **last** (after OSM/manual/GeoNames), deduped via the shared
  occupancy grid at 400 m — a named pin at the same spot always wins.
- `detected: true` on the Trek (validated); the panel badge reads **"terrain-detected ·
  unverified"** instead of "community · unverified"; `sources` links OpenTopoMap so a user can
  eyeball the contours.
- Names are honest placeholders — `Unnamed peak (~912 m)` — and the existing lazy enrichment
  fills in nearest town / photos / wildlife on open, exactly as for other bare pins.

## Verification

Unit: synthetic-grid detection (cone summit + relief, NMS shoulder suppression, spaced summits
kept, low-relief rejection, plateau tie, nodata/sea), pixel-maths round-trip, `toDetectedTreks`
(flag, scoring carry, named-pin-wins dedupe), pipeline append order, validation. Live: Savandurga
ground truth. Volume: calibrated before baking.

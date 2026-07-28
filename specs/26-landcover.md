# 26 — Ground cover (ESA WorldCover 10 m)

## Purpose

Whether a climb is through **forest, shrub, grassland, or bare rock** changes everything about it —
shade, water needs, scrambling — and none of our sources said. ESA WorldCover (10 m global land
cover, CC-BY 4.0, free, no key) does, hosted as Cloud-Optimised GeoTIFFs on a public S3 bucket in
3°×3° tiles.

## The reader (dependency-free, like the Terrarium PNG decoder)

npm is unavailable in this environment, so `scripts/sources/worldcover.ts` reads the COGs raw —
which turns out to be cheap because the format was probed first:

- classic little-endian TIFF, 8-bit, 1024×1024 internal tiles, **DEFLATE** (node:zlib inflates it),
  7 overview levels, and **every IFD + offset table within the first 64 KB**;
- so: ONE 64 KB ranged read per 3° tile gives the whole layout (`parseCogHeader`), then one ranged
  read per internal tile actually touched, both cached in memory;
- georeferencing derives from the tile name (`N12E075` spans 12–15°N 75–78°E, row 0 at the
  **northern** edge) — no GeoTIFF tag parsing needed (`cogNameFor` / `pixelFor`);
- deliberately narrow: throws on any other TIFF layout rather than pretending to be general.

Sampling at **overview level 2 (~40 m/px)** makes an internal tile cover ~41 km, so all ~7,800
treks resolve from a few hundred ranged reads.

## Sampling radius — 150 m, not the DEM's 450 m

Verified against ground truth before baking: at a 450 m ring, Savandurga's forested lower slopes
outvote its **bare granite summit** and it labels "Forest"; at 150 m it labels **"Bare / sparse"**
— which is what the climb is actually like. Pushpagiri reads all-Forest, MG Road reads Built-up.
`dominantLabel` takes the majority class over centre + 8-point ring, ignoring nodata.

## Model / pipeline / UI

- `landCover?: string`, validated against the fixed `LAND_COVERS` label set.
- `build:landcover` (hand-run) bakes it for every trek; a summit with no reading has any stale
  value dropped rather than kept wrong. Added to `PRESERVED_FIELDS` so the weekly cron can't wipe
  it (spec 25B).
- Detail panel: a "Ground cover" Fact.

## Not done: Overture Maps places

The other parked candidate needs a parquet + snappy + thrift reader — with no npm and no duckdb on
this machine, that's disproportionate to its value (POI data largely overlapping OSM). Documented
here so it isn't re-litigated; revisit only if the toolchain changes.

## Verification

Unit: synthetic in-memory COG (built by the test) → header parse, ranged-read sampling with
header/tile cache-hit counts, north-edge row order, unsupported-compression rejection; tile-name
and pixel mapping; majority labelling. Live: the four ground-truth spots above. Data:
`validate:data` passes with the label-set validation.

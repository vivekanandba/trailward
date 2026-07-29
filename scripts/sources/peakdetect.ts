/**
 * DEM peak detection (spec 27). Name databases only know NAMED hills — OSM,
 * GeoNames and every book we mined still miss real, climbed summits. The DEM
 * doesn't: this scans Terrarium elevation tiles directly for local maxima with
 * meaningful local relief, yielding candidates NO gazetteer lists.
 *
 * Method, per region:
 *  - iterate every pixel of every z12 tile (~36 m/px) within the radius;
 *  - a candidate is ≥ all 8 neighbours and > at least one (plateau-safe);
 *  - non-maximum suppression: it must also be the highest within ~600 m, so a
 *    massif yields one summit, not a ridge of pixels;
 *  - keep it if the drop to the lowest ground within ~1 km (local relief) meets
 *    the threshold: ≥150 m reads as a peak, 80–150 m as a hill.
 *
 * Pure grid maths over an elevation accessor; the tile-backed accessor with an
 * LRU (a full region is thousands of tiles — far too many to hold decoded)
 * lives in createTileGrid. Zero API quota: tiles are unlimited + disk-cached.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePngRgb, terrariumElevation, type DecodedTile } from "./demtiles";
import { fetchBuffer } from "./http";

export const DETECT_ZOOM = 12;
const TILE = 256;

/** Metres per pixel at a latitude for the detection zoom. */
export function metresPerPixel(lat: number, z = DETECT_ZOOM): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Global pixel coordinates (web-mercator) for a lat/lng at the detect zoom. */
export function globalPixel(lat: number, lng: number, z = DETECT_ZOOM): { gx: number; gy: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    gx: ((lng + 180) / 360) * n * TILE,
    gy: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE,
  };
}

/** Inverse of globalPixel. */
export function pixelToLatLng(
  gx: number,
  gy: number,
  z = DETECT_ZOOM,
): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = (gx / (n * TILE)) * 360 - 180;
  const y = Math.PI * (1 - (2 * gy) / (n * TILE));
  const lat = (Math.atan(Math.sinh(y)) * 180) / Math.PI;
  return { lat, lng };
}

export interface ElevGrid {
  /** Elevation in metres at global pixel (gx, gy); NaN where no data. */
  at(gx: number, gy: number): number;
}

export interface DetectedPeak {
  lat: number;
  lng: number;
  elevationM: number;
  reliefM: number; // drop to the lowest ground within the relief window
}

export interface DetectParams {
  minReliefM: number; // keep candidates at/above this local relief
  nmsRadiusPx: number; // must be the highest within this radius
  reliefRadiusPx: number; // window for the relief (lowest-ground) measure
}

/**
 * Scan a global-pixel rectangle for qualifying summits. Pure given the grid.
 * Iterates row-major; the tile LRU behind `grid` stays hot because neighbours
 * are visited together.
 */
export function detectPeaks(
  grid: ElevGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  params: DetectParams,
): DetectedPeak[] {
  const out: DetectedPeak[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const e = grid.at(x, y);
      if (Number.isNaN(e) || e <= 0) continue; // sea level / nodata never a summit
      if (e > 9000) continue; // corrupt DEM pixel (seen once: a 15,276 m "summit")

      // 8-neighbour local maximum: ≥ all, > at least one (plateau-safe).
      let greater = false;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = grid.at(x + dx, y + dy);
          if (Number.isNaN(n)) continue;
          if (n > e) {
            isMax = false;
            break;
          }
          if (e > n) greater = true;
        }
      }
      if (!isMax || !greater) continue;

      // Non-maximum suppression: highest within nmsRadiusPx (ties resolved by
      // scan order — the first pixel of an exact-tie plateau wins).
      const r = params.nmsRadiusPx;
      let suppressed = false;
      for (let dy = -r; dy <= r && !suppressed; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (dx * dx + dy * dy > r * r) continue;
          const n = grid.at(x + dx, y + dy);
          if (n > e || (n === e && (dy < 0 || (dy === 0 && dx < 0)))) {
            suppressed = true;
            break;
          }
        }
      }
      if (suppressed) continue;

      // Local relief: drop to the lowest ground within the relief window,
      // sampled on a ring + spokes (cheap, and a valley in any direction counts).
      const R = params.reliefRadiusPx;
      let lowest = e;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 2 * Math.PI;
        for (const f of [0.5, 1]) {
          const n = grid.at(
            Math.round(x + Math.cos(a) * R * f),
            Math.round(y + Math.sin(a) * R * f),
          );
          if (!Number.isNaN(n) && n < lowest) lowest = n;
        }
      }
      const reliefM = e - lowest;
      if (reliefM < params.minReliefM) continue;

      const { lat, lng } = pixelToLatLng(x + 0.5, y + 0.5);
      out.push({ lat, lng, elevationM: Math.round(e), reliefM: Math.round(reliefM) });
    }
  }
  return out;
}

/**
 * Tile-backed elevation grid with a bounded LRU of decoded tiles (a region is
 * thousands of tiles; decoded Int16 rows are ~128 KB each, so 1,500 ≈ 190 MB).
 * Missing tiles (ocean) read as NaN. Tiles are disk-cached, so re-runs are free.
 */
export function createTileGrid(opts: {
  cacheDir: string;
  z?: number;
  maxTiles?: number;
  fetchTile?: (x: number, y: number, z: number) => Promise<Buffer | null>;
}): { grid: ElevGrid; prefetch(x: number, y: number): Promise<void> } {
  const z = opts.z ?? DETECT_ZOOM;
  mkdirSync(opts.cacheDir, { recursive: true });
  const maxTiles = opts.maxTiles ?? 1500;
  const fetchTile =
    opts.fetchTile ??
    (async (x: number, y: number, zz: number): Promise<Buffer | null> =>
      fetchBuffer(`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${zz}/${x}/${y}.png`, {
        throttleMs: 60,
      }));

  const lru = new Map<string, Int16Array | null>(); // insertion-ordered
  const touch = (key: string, v: Int16Array | null): Int16Array | null => {
    lru.delete(key);
    lru.set(key, v);
    if (lru.size > maxTiles) lru.delete(lru.keys().next().value!);
    return v;
  };

  function decode(png: Buffer): Int16Array {
    const t: DecodedTile = decodePngRgb(png);
    const out = new Int16Array(t.width * t.height);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(terrariumElevation(t.rgb[i * 3], t.rgb[i * 3 + 1], t.rgb[i * 3 + 2]));
    }
    return out;
  }

  async function load(tx: number, ty: number): Promise<Int16Array | null> {
    const key = `${tx}/${ty}`;
    if (lru.has(key)) return touch(key, lru.get(key)!);
    const file = resolve(opts.cacheDir, `${z}_${tx}_${ty}.png`);
    let png: Buffer | null = null;
    if (existsSync(file)) {
      png = readFileSync(file);
    } else {
      png = await fetchTile(tx, ty, z);
      if (png) writeFileSync(file, png);
    }
    return touch(key, png ? decode(png) : null);
  }

  // Synchronous read path for the hot detection loop: tiles must be prefetched.
  const sync = new Map<string, Int16Array | null>();
  return {
    async prefetch(tx: number, ty: number): Promise<void> {
      sync.set(`${tx}/${ty}`, await load(tx, ty));
      if (sync.size > maxTiles) sync.delete(sync.keys().next().value!);
    },
    grid: {
      at(gx: number, gy: number): number {
        const tx = Math.floor(gx / TILE);
        const ty = Math.floor(gy / TILE);
        const t = sync.get(`${tx}/${ty}`);
        if (!t) return NaN;
        const v = t[(gy - ty * TILE) * TILE + (gx - tx * TILE)];
        return v === undefined ? NaN : v;
      },
    },
  };
}

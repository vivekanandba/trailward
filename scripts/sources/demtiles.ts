/**
 * Tile-based DEM (spec 17). Elevation from AWS "Terrarium" terrain tiles
 * (elevation-tiles-prod S3, free, no key) instead of per-point elevation APIs —
 * so we can DEM-score thousands of GeoNames summits without a daily-quota wall.
 * Nearby peaks share tiles, so a whole region resolves from a few thousand
 * cached PNGs rather than tens of thousands of API calls.
 *
 * Terrarium encodes metres as RGB: elevation = (R*256 + G + B/256) - 32768.
 * Tiles are 256×256, 8-bit truecolour (colour type 2), non-interlaced — the
 * simplest PNG, decodable with node:zlib alone (no image dependency).
 *
 * Split by testability: the PNG decode, tile math, and bilinear sampling are
 * pure; only the fetch+cache shell touches the network/disk.
 */
import { inflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LatLng } from "../../src/lib/terrain";
import { fetchBuffer } from "./http";

export const DEM_ZOOM = 13; // ~18.6 m/px at 13°N — matches SRTM's native ~30 m
const TILE = 256;

export interface DecodedTile {
  width: number;
  height: number;
  rgb: Buffer; // width*height*3
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode an 8-bit truecolour (RGB), non-interlaced PNG to a flat RGB buffer.
 * Deliberately narrow — it only handles the Terrarium tile format and throws on
 * anything else, rather than pretending to be a general PNG decoder.
 */
export function decodePngRgb(buf: Buffer): DecodedTile {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      const colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
        throw new Error(`unsupported PNG (bitDepth=${bitDepth} colorType=${colorType})`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = width * bpp;
  const rgb = Buffer.allocUnsafe(height * stride);
  let prev = Buffer.alloc(stride); // row above (zeros for row 0)
  let ri = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ri++];
    const row = raw.subarray(ri, ri + stride);
    ri += stride;
    const out = rgb.subarray(y * stride, y * stride + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0; // left
      const b = prev[x]; // up
      const c = x >= bpp ? prev[x - bpp] : 0; // up-left
      let v = row[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4:
          v += paeth(a, b, c);
          break;
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      out[x] = v & 0xff;
    }
    prev = out;
  }
  return { width, height, rgb };
}

/** Terrarium RGB → metres. */
export function terrariumElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface TilePoint {
  x: number;
  y: number;
  px: number; // pixel within tile, [0, 256)
  py: number;
}

/** Web-Mercator tile + in-tile pixel for a lat/lng at a zoom level. */
export function tileForPoint(lat: number, lng: number, z: number): TilePoint {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const gx = ((lng + 180) / 360) * n * TILE;
  const gy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE;
  const x = Math.floor(gx / TILE);
  const y = Math.floor(gy / TILE);
  return { x, y, px: gx - x * TILE, py: gy - y * TILE };
}

function elevAt(tile: DecodedTile, ix: number, iy: number): number {
  const cx = Math.min(tile.width - 1, Math.max(0, ix));
  const cy = Math.min(tile.height - 1, Math.max(0, iy));
  const i = (cy * tile.width + cx) * 3;
  return terrariumElevation(tile.rgb[i], tile.rgb[i + 1], tile.rgb[i + 2]);
}

/** Bilinear elevation sample at fractional pixel (px, py) within a tile. */
export function sampleElevation(tile: DecodedTile, px: number, py: number): number {
  const x0 = Math.floor(px - 0.5);
  const y0 = Math.floor(py - 0.5);
  const fx = px - 0.5 - x0;
  const fy = py - 0.5 - y0;
  const e00 = elevAt(tile, x0, y0);
  const e10 = elevAt(tile, x0 + 1, y0);
  const e01 = elevAt(tile, x0, y0 + 1);
  const e11 = elevAt(tile, x0 + 1, y0 + 1);
  const top = e00 * (1 - fx) + e10 * fx;
  const bot = e01 * (1 - fx) + e11 * fx;
  return top * (1 - fy) + bot * fy;
}

const tileKey = (x: number, y: number): string => `${x}/${y}`;

export interface DemTiles {
  /** Index-aligned elevations for the points (drop-in for fetchElevations). */
  elevations(points: LatLng[]): Promise<(number | undefined)[]>;
}

/**
 * Elevation source backed by Terrarium tiles, with an in-memory + on-disk cache
 * (DEM is static, so a tile is fetched at most once ever). `fetchTile` is
 * injectable for tests; the default pulls from the S3 endpoint through the
 * allowlisted, redirect-following buffer fetcher.
 */
export function createDemTiles(
  opts: {
    z?: number;
    cacheDir?: string;
    fetchTile?: (x: number, y: number, z: number) => Promise<Buffer | null>;
  } = {},
): DemTiles {
  const z = opts.z ?? DEM_ZOOM;
  const cacheDir = opts.cacheDir;
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const mem = new Map<string, DecodedTile | null>();

  const defaultFetch = async (x: number, y: number, zz: number): Promise<Buffer | null> =>
    fetchBuffer(`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${zz}/${x}/${y}.png`, {
      throttleMs: 100, // S3 tolerates high request rates
    });
  const fetchTile = opts.fetchTile ?? defaultFetch;

  async function getTile(x: number, y: number): Promise<DecodedTile | null> {
    const key = tileKey(x, y);
    const cached = mem.get(key);
    if (cached !== undefined) return cached;

    const file = cacheDir ? resolve(cacheDir, `${z}_${x}_${y}.png`) : undefined;
    let png: Buffer | null = null;
    if (file && existsSync(file)) {
      png = readFileSync(file);
    } else {
      png = await fetchTile(x, y, z);
      if (png && file) writeFileSync(file, png);
    }
    const decoded = png ? decodePngRgb(png) : null;
    mem.set(key, decoded);
    return decoded;
  }

  return {
    async elevations(points: LatLng[]): Promise<(number | undefined)[]> {
      const out: (number | undefined)[] = [];
      for (const p of points) {
        const t = tileForPoint(p.lat, p.lng, z);
        const tile = await getTile(t.x, t.y);
        out.push(tile ? Math.round(sampleElevation(tile, t.px, t.py)) : undefined);
      }
      return out;
    },
  };
}

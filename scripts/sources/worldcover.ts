/**
 * ESA WorldCover 10 m land cover (spec 26) — what a climb is actually like
 * underfoot: forest, shrub, grass, or bare rock. The data is free, no-key,
 * CC-BY 4.0, hosted as Cloud-Optimised GeoTIFFs on a public S3 bucket in
 * 3°×3° tiles (e.g. N12E075 spans 12–15°N, 75–78°E).
 *
 * Like the Terrarium reader (demtiles.ts), this is deliberately narrow: it
 * reads exactly the COG layout WorldCover v200 ships — classic little-endian
 * TIFF, 8-bit samples, 1024×1024 tiles, DEFLATE (compression 8, which
 * node:zlib inflates), overview IFDs chained after the full-resolution one,
 * all IFDs and offset tables within the first 64 KB — and throws on anything
 * else rather than pretending to be a general TIFF reader.
 *
 * Cost model: ONE 64 KB header read per 3° tile, then one ~100 KB range read
 * per internal 1024px tile actually touched. At overview level 2 (40 m/px) an
 * internal tile covers ~41 km × 41 km, so a whole region's peaks share a
 * handful of tiles.
 */
import { inflateSync } from "node:zlib";
import { fetchBuffer } from "./http";

// v200 class values → short labels a trekker understands. 0 = nodata.
export const WORLDCOVER_LABELS: Record<number, string> = {
  10: "Forest",
  20: "Shrubland",
  30: "Grassland",
  40: "Cropland",
  50: "Built-up",
  60: "Bare / sparse",
  70: "Snow & ice",
  80: "Water",
  90: "Wetland",
  95: "Mangroves",
  100: "Moss & lichen",
};

// Classes that describe the ground itself. The anthropic ones (cropland,
// built-up) showing up ON a summit are nearly always fort masonry or a temple
// compound — real pixels, but misleading as "what the climb is like", so they
// only win when no natural pixel was sampled at all (e.g. a pin in a city).
const NATURAL = new Set([10, 20, 30, 60, 70, 90, 95, 100]);

/** Majority class label over sampled pixels; natural classes outrank anthropic
 *  ones (Madhugiri's fort walls classify as Built-up — the climb is bare rock);
 *  nodata ignored. */
export function dominantLabel(values: number[]): string | undefined {
  const majority = (vals: number[]): number | undefined => {
    const counts = new Map<number, number>();
    for (const v of vals) {
      if (!WORLDCOVER_LABELS[v]) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: number | undefined;
    for (const [v, n] of counts) {
      if (best === undefined || n > counts.get(best)!) best = v;
    }
    return best;
  };
  const best = majority(values.filter((v) => NATURAL.has(v))) ?? majority(values);
  return best === undefined ? undefined : WORLDCOVER_LABELS[best];
}

export interface CogLevel {
  width: number;
  height: number;
  tileW: number;
  tileH: number;
  tileOffsets: number[];
  tileByteCounts: number[];
}

/**
 * Parse the IFD chain of a WorldCover COG from its header bytes (the first
 * 64 KB — verified to contain every IFD and offset table). Returns full-res
 * level first, then successively smaller overviews.
 */
export function parseCogHeader(buf: Buffer): CogLevel[] {
  if (buf.toString("latin1", 0, 2) !== "II" || buf.readUInt16LE(2) !== 42) {
    throw new Error("not a little-endian classic TIFF");
  }
  const levels: CogLevel[] = [];
  let ifdOff = buf.readUInt32LE(4);
  while (ifdOff !== 0) {
    if (ifdOff + 2 > buf.length) throw new Error("IFD beyond header window");
    const n = buf.readUInt16LE(ifdOff);
    const entries = new Map<number, { type: number; count: number; value: number }>();
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      entries.set(buf.readUInt16LE(e), {
        type: buf.readUInt16LE(e + 2),
        count: buf.readUInt32LE(e + 4),
        value: buf.readUInt32LE(e + 8),
      });
    }
    const num = (tag: number): number => {
      const e = entries.get(tag);
      if (!e) throw new Error(`missing TIFF tag ${tag}`);
      return e.value;
    };
    // LONG array: inline when count===1, else a pointer into the header buffer.
    const longs = (tag: number): number[] => {
      const e = entries.get(tag);
      if (!e) throw new Error(`missing TIFF tag ${tag}`);
      if (e.count === 1) return [e.value];
      if (e.value + e.count * 4 > buf.length) throw new Error(`tag ${tag} array beyond header`);
      const out: number[] = [];
      for (let i = 0; i < e.count; i++) out.push(buf.readUInt32LE(e.value + i * 4));
      return out;
    };
    const compression = num(259);
    if (compression !== 8) throw new Error(`unsupported compression ${compression} (want DEFLATE)`);
    if (num(258) !== 8) throw new Error("unsupported bit depth (want 8)");
    levels.push({
      width: num(256),
      height: num(257),
      tileW: num(322),
      tileH: num(323),
      tileOffsets: longs(324),
      tileByteCounts: longs(325),
    });
    ifdOff = buf.readUInt32LE(ifdOff + 2 + n * 12);
    if (levels.length > 12) throw new Error("implausible IFD chain");
  }
  if (levels.length === 0) throw new Error("no IFDs found");
  return levels;
}

/** The 3°-grid WorldCover tile a coordinate falls in, e.g. "N12E075". */
export function cogNameFor(lat: number, lng: number): string {
  const south = Math.floor(lat / 3) * 3;
  const west = Math.floor(lng / 3) * 3;
  const ns = south < 0 ? "S" : "N";
  const ew = west < 0 ? "W" : "E";
  return `${ns}${String(Math.abs(south)).padStart(2, "0")}${ew}${String(Math.abs(west)).padStart(3, "0")}`;
}

/** Pixel position of a coordinate within its 3° COG at a given level size. */
export function pixelFor(
  lat: number,
  lng: number,
  level: { width: number; height: number },
): { px: number; py: number } {
  const south = Math.floor(lat / 3) * 3;
  const west = Math.floor(lng / 3) * 3;
  const px = Math.min(level.width - 1, Math.floor(((lng - west) / 3) * level.width));
  // Row 0 is the tile's NORTHERN edge.
  const py = Math.min(level.height - 1, Math.floor(((south + 3 - lat) / 3) * level.height));
  return { px, py };
}

const BUCKET = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map";
const HEADER_BYTES = 65536;

export interface WorldCover {
  /** Land-cover class values (see WORLDCOVER_LABELS) for each point; undefined where no tile. */
  classesAt(points: { lat: number; lng: number }[]): Promise<(number | undefined)[]>;
}

/**
 * Land-cover sampler over WorldCover COGs with in-memory caches (headers per
 * 3° tile, decompressed data per internal tile). `fetchRange` is injectable
 * for tests; the default issues HTTP Range reads against the public bucket.
 * `level` selects the overview: 2 (~40 m/px) is plenty to classify what a
 * summit's slopes are covered in, and keeps internal-tile fetches rare.
 */
export function createWorldCover(
  opts: {
    level?: number;
    fetchRange?: (name: string, start: number, end: number) => Promise<Buffer | null>;
  } = {},
): WorldCover {
  const levelIdx = opts.level ?? 2;
  const fetchRange =
    opts.fetchRange ??
    (async (name: string, start: number, end: number): Promise<Buffer | null> =>
      fetchBuffer(`${BUCKET}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`, {
        headers: { range: `bytes=${start}-${end}` },
        throttleMs: 100, // public S3 bucket
      }));

  const headers = new Map<string, CogLevel[] | null>();
  // Decompressed internal tiles are ~1 MB each; an all-India run touches ~2,000
  // of them, so cap the cache (FIFO) — callers sample in spatial order, which
  // keeps the working set tiny anyway.
  const MAX_TILES = 256;
  const tiles = new Map<string, Buffer | null>();

  async function levelFor(name: string): Promise<CogLevel | null> {
    if (!headers.has(name)) {
      const buf = await fetchRange(name, 0, HEADER_BYTES - 1);
      headers.set(name, buf ? parseCogHeader(buf) : null);
    }
    const lv = headers.get(name);
    if (!lv) return null;
    return lv[Math.min(levelIdx, lv.length - 1)];
  }

  async function tileData(name: string, lv: CogLevel, tileIdx: number): Promise<Buffer | null> {
    const key = `${name}/${tileIdx}`;
    if (!tiles.has(key)) {
      const off = lv.tileOffsets[tileIdx];
      const len = lv.tileByteCounts[tileIdx];
      if (off === undefined || len === undefined || len === 0) {
        tiles.set(key, null);
      } else {
        const raw = await fetchRange(name, off, off + len - 1);
        if (tiles.size >= MAX_TILES) tiles.delete(tiles.keys().next().value!);
        tiles.set(key, raw ? inflateSync(raw) : null);
      }
    }
    return tiles.get(key) ?? null;
  }

  return {
    async classesAt(points): Promise<(number | undefined)[]> {
      const out: (number | undefined)[] = [];
      for (const p of points) {
        const name = cogNameFor(p.lat, p.lng);
        let value: number | undefined;
        try {
          const lv = await levelFor(name);
          if (lv) {
            const { px, py } = pixelFor(p.lat, p.lng, lv);
            const tilesAcross = Math.ceil(lv.width / lv.tileW);
            const tileIdx = Math.floor(py / lv.tileH) * tilesAcross + Math.floor(px / lv.tileW);
            const data = await tileData(name, lv, tileIdx);
            if (data) value = data[(py % lv.tileH) * lv.tileW + (px % lv.tileW)];
          }
        } catch (err) {
          // Transient failure → leave nothing cached, so the NEXT point retries
          // this COG. (Permanently nulling the header here once poisoned every
          // point in a whole 3° tile for the rest of a run — thousands of
          // records lost their reading to one flaky request.)
          console.warn(`[worldcover] ${name}: ${(err as Error).message}`);
          headers.delete(name);
        }
        out.push(value);
      }
      return out;
    },
  };
}

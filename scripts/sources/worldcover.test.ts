import { describe, it, expect, vi } from "vitest";
import { deflateSync } from "node:zlib";
import {
  parseCogHeader,
  cogNameFor,
  pixelFor,
  dominantLabel,
  createWorldCover,
} from "./worldcover";

/**
 * Build a minimal WorldCover-shaped COG in memory: little-endian classic TIFF,
 * one IFD, 8-bit, DEFLATE, one tile holding `pixels` (tileW×tileH row-major).
 */
function makeCog(width: number, height: number, tileW: number, tileH: number, pixels: number[]) {
  const tile = deflateSync(Buffer.from(pixels));
  const entries: [number, number, number, number][] = [
    // [tag, type, count, value]
    [256, 3, 1, width],
    [257, 3, 1, height],
    [258, 3, 1, 8],
    [259, 3, 1, 8], // DEFLATE
    [322, 3, 1, tileW],
    [323, 3, 1, tileH],
    [324, 4, 1, 0], // tileOffsets — patched below
    [325, 4, 1, tile.length],
  ];
  const ifdOff = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const tileOff = ifdOff + ifdSize;
  entries[6][3] = tileOff;

  const buf = Buffer.alloc(tileOff + tile.length);
  buf.write("II", 0, "latin1");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdOff, 4);
  buf.writeUInt16LE(entries.length, ifdOff);
  entries.forEach(([tag, type, count, value], i) => {
    const e = ifdOff + 2 + i * 12;
    buf.writeUInt16LE(tag, e);
    buf.writeUInt16LE(type, e + 2);
    buf.writeUInt32LE(count, e + 4);
    buf.writeUInt32LE(value, e + 8);
  });
  buf.writeUInt32LE(0, ifdOff + 2 + entries.length * 12); // no next IFD
  tile.copy(buf, tileOff);
  return buf;
}

describe("parseCogHeader", () => {
  it("reads dimensions, tiling, and offset arrays from a valid COG", () => {
    const cog = makeCog(4, 4, 4, 4, Array(16).fill(10));
    const levels = parseCogHeader(cog);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ width: 4, height: 4, tileW: 4, tileH: 4 });
    expect(levels[0].tileOffsets).toHaveLength(1);
  });

  it("rejects non-TIFF input and unsupported compression", () => {
    expect(() => parseCogHeader(Buffer.from("PNG..."))).toThrow(/TIFF/);
    const lzw = makeCog(4, 4, 4, 4, Array(16).fill(10));
    // Patch compression tag (entry 3, value at offset ifd+2+3*12+8) to LZW=5.
    lzw.writeUInt32LE(5, 8 + 2 + 3 * 12 + 8);
    expect(() => parseCogHeader(lzw)).toThrow(/compression/);
  });
});

describe("cogNameFor / pixelFor", () => {
  it("maps coordinates to the 3°-grid tile name", () => {
    expect(cogNameFor(12.92, 77.29)).toBe("N12E075");
    expect(cogNameFor(13.5, 78.1)).toBe("N12E078");
    expect(cogNameFor(-1.2, 36.8)).toBe("S03E036");
  });

  it("maps a coordinate to a pixel with row 0 at the NORTHERN edge", () => {
    const level = { width: 300, height: 300 }; // 0.01°/px on a 3° tile
    // Just inside the north-west corner of N12E075 (lat→15, lng→75).
    expect(pixelFor(14.995, 75.005, level)).toEqual({ px: 0, py: 0 });
    // South-east corner.
    expect(pixelFor(12.005, 77.995, level)).toEqual({ px: 299, py: 299 });
  });
});

describe("dominantLabel", () => {
  it("returns the majority class label, ignoring nodata", () => {
    expect(dominantLabel([10, 10, 60, 0, 0])).toBe("Forest");
    expect(dominantLabel([60, 60, 30, 10])).toBe("Bare / sparse");
  });

  it("returns undefined when nothing valid was sampled", () => {
    expect(dominantLabel([0, 0])).toBeUndefined();
    expect(dominantLabel([])).toBeUndefined();
  });
});

describe("createWorldCover", () => {
  // A 4×4 single-tile COG for the whole N12E075 tile: NW quadrant forest (10),
  // the rest bare (60).
  const pixels = [10, 10, 60, 60, 10, 10, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60];
  const cog = makeCog(4, 4, 4, 4, pixels);

  it("samples classes via ranged reads, caching the header and tile", async () => {
    const fetchRange = vi.fn(async (_name: string, start: number, end: number) =>
      cog.subarray(start, Math.min(end + 1, cog.length)),
    );
    const wc = createWorldCover({ level: 0, fetchRange });
    // NW quadrant of the 3° tile → forest; SE → bare.
    const out = await wc.classesAt([
      { lat: 14.9, lng: 75.1 },
      { lat: 12.1, lng: 77.9 },
      { lat: 14.9, lng: 75.2 },
    ]);
    expect(out).toEqual([10, 60, 10]);
    // 1 header read + 1 tile read — the third point hits both caches.
    expect(fetchRange).toHaveBeenCalledTimes(2);
  });

  it("degrades to undefined where no COG exists (ocean)", async () => {
    const wc = createWorldCover({ level: 0, fetchRange: async () => null });
    expect(await wc.classesAt([{ lat: 0, lng: -30 }])).toEqual([undefined]);
  });

  it("retries a COG after a transient error instead of poisoning the whole 3° tile", async () => {
    let calls = 0;
    const fetchRange = vi.fn(async (_name: string, start: number, end: number) => {
      if (++calls === 1) throw new Error("flaky network");
      return cog.subarray(start, Math.min(end + 1, cog.length));
    });
    const wc = createWorldCover({ level: 0, fetchRange });
    const out = await wc.classesAt([
      { lat: 14.9, lng: 75.1 }, // hits the flaky first request → no reading
      { lat: 14.9, lng: 75.1 }, // must RETRY the header, not see a cached null
    ]);
    expect(out).toEqual([undefined, 10]);
  });

  it("stops refetching a persistently broken COG after repeated failures", async () => {
    const fetchRange = vi.fn(async () => {
      throw new Error("malformed forever");
    });
    const wc = createWorldCover({ level: 0, fetchRange });
    const pts = Array.from({ length: 6 }, () => ({ lat: 14.9, lng: 75.1 }));
    expect(await wc.classesAt(pts)).toEqual(Array(6).fill(undefined));
    // 3 attempts, then the COG is cached as absent — not one fetch per point.
    expect(fetchRange).toHaveBeenCalledTimes(3);
  });
});

describe("dominantLabel natural-first rule", () => {
  it("lets bare rock beat the fort masonry classified as built-up (Madhugiri case)", () => {
    expect(dominantLabel([60, 40, 50, 10, 50, 50, 50, 30, 40])).not.toBe("Built-up");
    expect(dominantLabel([60, 60, 50, 50, 50])).toBe("Bare / sparse");
  });

  it("still reports anthropic cover when nothing natural was sampled", () => {
    expect(dominantLabel([50, 50, 40])).toBe("Built-up");
  });
});

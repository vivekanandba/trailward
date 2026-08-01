import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import {
  createTileGrid,
  detectPeaks,
  globalPixel,
  pixelToLatLng,
  metresPerPixel,
  type ElevGrid,
} from "./peakdetect";

/** Grid backed by a function — flat world with sculpted features. */
const gridOf = (f: (x: number, y: number) => number): ElevGrid => ({ at: f });

// A conical hill: height `peak` at (cx,cy) falling off 10 m per pixel.
const cone =
  (cx: number, cy: number, peak: number) =>
  (x: number, y: number): number =>
    Math.max(100, peak - 10 * Math.hypot(x - cx, y - cy));

const PARAMS = { minReliefM: 80, nmsRadiusPx: 8, reliefRadiusPx: 12 };

describe("detectPeaks", () => {
  it("finds a single conical summit at the right place with its relief", () => {
    const peaks = detectPeaks(gridOf(cone(50, 50, 500)), 20, 20, 80, 80, PARAMS);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].elevationM).toBe(500);
    expect(peaks[0].reliefM).toBeGreaterThanOrEqual(80); // falls to 380 within 12px
  });

  it("suppresses a shoulder next to a higher summit (NMS)", () => {
    // Two cones 5 px apart — well inside the 8 px NMS radius; only the taller survives.
    const f = (x: number, y: number): number =>
      Math.max(cone(50, 50, 500)(x, y), cone(55, 50, 460)(x, y));
    const peaks = detectPeaks(gridOf(f), 20, 20, 80, 80, PARAMS);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].elevationM).toBe(500);
  });

  it("keeps two summits farther apart than the NMS radius", () => {
    const f = (x: number, y: number): number =>
      Math.max(cone(40, 50, 500)(x, y), cone(70, 50, 460)(x, y));
    const peaks = detectPeaks(gridOf(f), 20, 20, 100, 80, PARAMS);
    expect(peaks.map((p) => p.elevationM).sort()).toEqual([460, 500]);
  });

  it("rejects a bump with too little relief", () => {
    const peaks = detectPeaks(gridOf(cone(50, 50, 160)), 20, 20, 80, 80, PARAMS);
    expect(peaks).toHaveLength(0); // only 60 m above the 100 m plain
  });

  it("emits exactly one summit for an exact-tie plateau", () => {
    const f = (x: number, y: number): number =>
      x >= 49 && x <= 51 && y === 50 ? 500 : cone(50, 50, 490)(x, y);
    const peaks = detectPeaks(gridOf(f), 20, 20, 80, 80, PARAMS);
    expect(peaks).toHaveLength(1);
  });

  it("ignores nodata and sea level", () => {
    expect(
      detectPeaks(
        gridOf(() => NaN),
        0,
        0,
        40,
        40,
        PARAMS,
      ),
    ).toHaveLength(0);
    expect(
      detectPeaks(
        gridOf(() => 0),
        0,
        0,
        40,
        40,
        PARAMS,
      ),
    ).toHaveLength(0);
  });
});

describe("pixel maths", () => {
  it("globalPixel/pixelToLatLng round-trip", () => {
    const { gx, gy } = globalPixel(12.9192, 77.2948);
    const back = pixelToLatLng(gx, gy);
    expect(back.lat).toBeCloseTo(12.9192, 4);
    expect(back.lng).toBeCloseTo(77.2948, 4);
  });

  it("metresPerPixel shrinks with latitude", () => {
    expect(metresPerPixel(0)).toBeGreaterThan(metresPerPixel(45));
    expect(metresPerPixel(13)).toBeCloseTo(37.2, 0);
  });
});

describe("createTileGrid", () => {
  // Terrarium PNG encoder (same shape as demtiles.test): value v metres.
  const enc = (m: number): number[] => {
    const v = Math.round((m + 32768) * 256);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  };
  function tilePng(elevM: number): Buffer {
    const w = 256;
    const stride = w * 3;
    const raw = Buffer.alloc(w * (stride + 1));
    for (let y = 0; y < w; y++) {
      raw[y * (stride + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const [r, g, b] = enc(elevM);
        const o = y * (stride + 1) + 1 + x * 3;
        raw[o] = r;
        raw[o + 1] = g;
        raw[o + 2] = b;
      }
    }
    const chunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(w, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(2, 9);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  it("prefetches, decodes, disk-caches, and reads elevations; missing tiles are NaN", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/tilegrid-`);
    let fetches = 0;
    const { grid, prefetch } = createTileGrid({
      cacheDir: dir,
      fetchTile: async (x) => {
        fetches++;
        return x === 100 ? tilePng(750) : null; // only tile x=100 exists
      },
    });
    await prefetch(100, 200);
    await prefetch(101, 200); // "ocean" tile
    expect(grid.at(100 * 256 + 5, 200 * 256 + 5)).toBe(750);
    expect(Number.isNaN(grid.at(101 * 256 + 5, 200 * 256 + 5))).toBe(true);
    expect(Number.isNaN(grid.at(0, 0))).toBe(true); // never prefetched
    // Second grid instance reads tile 100 from DISK, not the network.
    const second = createTileGrid({
      cacheDir: dir,
      fetchTile: async () => {
        throw new Error("must not refetch");
      },
    });
    await second.prefetch(100, 200);
    expect(second.grid.at(100 * 256 + 8, 200 * 256 + 8)).toBe(750);
    expect(fetches).toBe(2);
  });
});

describe("corrupt-pixel guard", () => {
  it("never emits a summit from an implausible elevation", () => {
    const f = (x: number, y: number): number => (x === 50 && y === 50 ? 15276 : 100);
    expect(detectPeaks(gridOf(f), 20, 20, 80, 80, PARAMS)).toHaveLength(0);
  });
});

describe("highland banding (spec 30)", () => {
  it("applies the stricter relief floor above the highland elevation", () => {
    const params = {
      minReliefM: 80,
      nmsRadiusPx: 8,
      reliefRadiusPx: 12,
      highland: { elevM: 2500, minReliefM: 300, nmsRadiusPx: 8 },
    };
    // A 3000 m cone with only 120 m of relief: fine in the lowlands, rejected
    // in the high country.
    const highSmall = (x: number, y: number): number =>
      Math.max(2880, 3000 - 10 * Math.hypot(x - 50, y - 50));
    expect(detectPeaks(gridOf(highSmall), 20, 20, 80, 80, params)).toHaveLength(0);
    // The same shape at 500 m qualifies (relief 120 ≥ 80).
    const lowSmall = (x: number, y: number): number =>
      Math.max(380, 500 - 10 * Math.hypot(x - 50, y - 50));
    expect(detectPeaks(gridOf(lowSmall), 20, 20, 80, 80, params)).toHaveLength(1);
  });
});

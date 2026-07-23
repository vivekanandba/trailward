import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import {
  decodePngRgb,
  terrariumElevation,
  tileForPoint,
  sampleElevation,
  createDemTiles,
  type DecodedTile,
} from "./demtiles";

// Minimal 8-bit truecolour PNG encoder for fixtures. CRCs are zero — the decoder
// (like the format) ignores them — so we don't need a CRC32 implementation here.
function encodePng(width: number, height: number, rgb: number[][]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type 2 = truecolour
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb[y * width + x];
      const o = y * (stride + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Encode a metre value as a Terrarium RGB triple.
const enc = (m: number): number[] => {
  const v = Math.round((m + 32768) * 256);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

describe("terrariumElevation", () => {
  it("decodes the RGB→metre formula (0 m ↔ 32768)", () => {
    expect(terrariumElevation(128, 0, 0)).toBe(0);
    const [r, g, b] = enc(1069);
    expect(terrariumElevation(r, g, b)).toBeCloseTo(1069, 3);
  });
});

describe("decodePngRgb", () => {
  it("round-trips an 8-bit RGB PNG", () => {
    const px = [
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
      [100, 110, 120],
    ];
    const t = decodePngRgb(encodePng(2, 2, px));
    expect([t.width, t.height]).toEqual([2, 2]);
    expect([...t.rgb]).toEqual(px.flat());
  });

  it("rejects a non-PNG buffer", () => {
    expect(() => decodePngRgb(Buffer.from("nope"))).toThrow(/not a PNG/);
  });
});

describe("tileForPoint", () => {
  it("maps (0,0) at z0 to the centre of the single world tile", () => {
    const t = tileForPoint(0, 0, 0);
    expect(t).toMatchObject({ x: 0, y: 0 });
    expect(t.px).toBeCloseTo(128, 6);
    expect(t.py).toBeCloseTo(128, 6);
  });

  it("increases tile x eastward and y southward", () => {
    const west = tileForPoint(13, 77, 12);
    const east = tileForPoint(13, 78, 12);
    const south = tileForPoint(12, 77, 12);
    expect(east.x).toBeGreaterThanOrEqual(west.x);
    expect(south.y).toBeGreaterThanOrEqual(west.y);
  });
});

describe("sampleElevation (bilinear)", () => {
  const tile: DecodedTile = {
    width: 2,
    height: 2,
    rgb: Buffer.from([...enc(100), ...enc(200), ...enc(300), ...enc(400)]),
  };
  it("returns a pixel centre value exactly", () => {
    expect(sampleElevation(tile, 0.5, 0.5)).toBeCloseTo(100, 3);
    expect(sampleElevation(tile, 1.5, 1.5)).toBeCloseTo(400, 3);
  });
  it("interpolates between pixel centres", () => {
    // midway between the four centres → mean of the corners
    expect(sampleElevation(tile, 1, 1)).toBeCloseTo((100 + 200 + 300 + 400) / 4, 1);
  });
});

describe("createDemTiles.elevations", () => {
  it("samples elevations via an injected tile fetcher, caching each tile once", async () => {
    let fetches = 0;
    const flat = encodePng(2, 2, [enc(500), enc(500), enc(500), enc(500)]);
    const dem = createDemTiles({
      z: 12,
      fetchTile: async () => {
        fetches++;
        return flat;
      },
    });
    const pts = [
      { lat: 13.0, lng: 77.0 },
      { lat: 13.001, lng: 77.001 },
    ];
    const elevs = await dem.elevations(pts);
    expect(elevs).toHaveLength(2);
    for (const e of elevs) expect(e).toBeCloseTo(500, 0);
    // Both points fall in the same z12 tile → fetched once.
    expect(fetches).toBe(1);
  });

  it("yields undefined where a tile is missing (404 → null)", async () => {
    const dem = createDemTiles({ z: 12, fetchTile: async () => null });
    expect(await dem.elevations([{ lat: 0, lng: 0 }])).toEqual([undefined]);
  });
});

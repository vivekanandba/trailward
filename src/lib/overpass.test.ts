import { describe, it, expect, vi, afterEach } from "vitest";
import { MAX_DISCOVERY, discoverPeaks, parsePeaks } from "./overpass";
import { DEFAULT_ORIGIN, isTrek } from "./trek";

const overpassFixture = {
  elements: [
    {
      type: "node",
      id: 123,
      lat: 13.5021,
      lon: 77.6911,
      tags: { name: "Skandagiri", natural: "peak", ele: "1350" },
    },
    {
      type: "node",
      id: 124,
      lat: 13.1,
      lon: 77.2,
      tags: { natural: "peak" }, // unnamed, no elevation
    },
    {
      type: "node",
      id: 125,
      lat: "bad",
      lon: 77.0,
      tags: { name: "Broken", natural: "peak" }, // invalid coords → dropped
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parsePeaks (pure, shared with pipeline)", () => {
  it("turns Overpass nodes into partial treks with coords and elevation", () => {
    const peaks = parsePeaks(overpassFixture);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toMatchObject({
      id: "osm-123",
      name: "Skandagiri",
      lat: 13.5021,
      lng: 77.6911,
      elevationM: 1350,
    });
  });

  it("names unnamed peaks and omits unparseable elevation", () => {
    const peaks = parsePeaks(overpassFixture);
    expect(peaks[1].name).toBe("Unnamed Peak");
    expect(peaks[1].elevationM).toBeUndefined();
  });

  it("drops nodes with invalid coordinates", () => {
    expect(parsePeaks(overpassFixture).some((p) => p.id === "osm-125")).toBe(false);
  });

  it("returns [] for input without an elements array", () => {
    expect(parsePeaks({})).toEqual([]);
  });
});

describe("discoverPeaks (runtime fetch)", () => {
  it("returns valid discovery-tier treks for the active origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => overpassFixture }),
    );

    const treks = await discoverPeaks(DEFAULT_ORIGIN, 100);
    expect(treks.length).toBeGreaterThan(0);
    for (const t of treks) {
      expect(t.tier).toBe("discovery");
      expect(t.verified).toBe(false);
      expect(t.cityId).toBe(DEFAULT_ORIGIN.id);
      expect(isTrek(t)).toBe(true);
    }
  });

  it("returns [] on a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 504 }));
    expect(await discoverPeaks(DEFAULT_ORIGIN, 100)).toEqual([]);
  });

  it("caps results at MAX_DISCOVERY and warns instead of silently truncating", async () => {
    const many = {
      elements: Array.from({ length: MAX_DISCOVERY + 5 }, (_, i) => ({
        type: "node",
        id: i,
        lat: 13 + i / 1000,
        lon: 77,
        tags: { name: `Peak ${i}`, natural: "peak", ele: String(500 + i) },
      })),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => many }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const treks = await discoverPeaks(DEFAULT_ORIGIN, 100);
    expect(treks).toHaveLength(MAX_DISCOVERY);
    expect(warn).toHaveBeenCalled();
  });
});

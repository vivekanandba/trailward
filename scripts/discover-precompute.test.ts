import { describe, it, expect } from "vitest";
import {
  precomputeRegion,
  dedupeAgainstCurated,
  type DiscoverFetchers,
} from "./discover-precompute";
import { validateTrek, type Origin, type Trek } from "../src/lib/trek";
import type { ParsedPeak } from "../src/lib/overpass";

const PUNE: Origin = { id: "geo:18.5204,73.8567", name: "Pune", lat: 18.5204, lng: 73.8567 };

// A rugged, undocumented peak and a flat, famous one. The flat one is TALLER,
// so it sorts first as a candidate — the point is that scoring, not elevation,
// decides the final rank.
const ruggedUnknown: ParsedPeak = {
  id: "osm-1",
  name: "Rugged Unknown",
  lat: 18.51,
  lng: 73.84,
  elevationM: 1400,
  notability: { hasWikipediaTag: false, hasWikidataTag: false },
};
const flatFamous: ParsedPeak = {
  id: "osm-2",
  name: "Flat Famous",
  lat: 18.53,
  lng: 73.86,
  elevationM: 1500,
  notability: { hasWikipediaTag: true, hasWikidataTag: true },
};

// Elevations index-aligned to [flatFamous(center+8 ring), ruggedUnknown(center+8 ring)]
// (candidates are sorted by elevation desc, so flatFamous comes first).
const elevs = [
  1500,
  ...Array<number>(8).fill(1495), // flat: relief 5 → confidence 0 → topo 0
  1400,
  ...Array<number>(8).fill(1100), // rugged: relief 300, slope ~34° → topo ~1
];

const fetchers = (over: Partial<DiscoverFetchers> = {}): DiscoverFetchers => ({
  peaks: async () => [ruggedUnknown, flatFamous],
  elevations: async () => elevs,
  tourismPoints: async () => [],
  wikiArticles: async () => 0,
  ...over,
});

describe("precomputeRegion", () => {
  it("ranks a rugged, undocumented peak above a flat, famous, taller one", async () => {
    const treks = await precomputeRegion(PUNE, 150, fetchers());
    expect(treks).toHaveLength(2);
    expect(treks[0].name).toBe("Rugged Unknown");
    expect(treks[0].discoveryScore!).toBeGreaterThan(treks[1].discoveryScore!);
  });

  it("emits valid discovery-tier treks scoped to the region", async () => {
    const [top] = await precomputeRegion(PUNE, 150, fetchers());
    expect(validateTrek(top).ok).toBe(true);
    expect(top.tier).toBe("discovery");
    expect(top.verified).toBe(false);
    expect(top.cityId).toBe(PUNE.id);
    expect(top.id).toBe("osm-1--pune"); // region-suffixed id keeps regions unique
    expect(top.sources[0]).toContain("openstreetmap.org/node/1");
  });

  it("computes and rounds the terrain fields + estimated difficulty", async () => {
    const [top] = await precomputeRegion(PUNE, 150, fetchers());
    expect(top.reliefM).toBe(300);
    expect(top.prominenceProxyM).toBe(300);
    expect(top.meanSlopeDeg).toBeCloseTo(33.7, 0);
    expect(top.terrainConfidence).toBe(1);
    expect(top.estimatedDifficulty).toBe("Hard"); // slope ≥ 20°
  });

  it("prefers an authoritative OSM prominence tag over the DEM proxy", async () => {
    const withProm: ParsedPeak = {
      ...ruggedUnknown,
      notability: { ...ruggedUnknown.notability, osmProminenceM: 555 },
    };
    const single = await precomputeRegion(PUNE, 150, {
      peaks: async () => [withProm],
      elevations: async () => [1400, ...Array<number>(8).fill(1100)], // DEM proxy would be 300
      tourismPoints: async () => [],
      wikiArticles: async () => 0,
    });
    expect(single[0].prominenceProxyM).toBe(555);
  });

  it("refuses to emit a region when elevations misalign with sample points", async () => {
    await expect(
      precomputeRegion(
        PUNE,
        150,
        fetchers({ elevations: async () => [1400, 1100] }), // far fewer than 2×9 points
      ),
    ).rejects.toThrow(/misaligned/);
  });

  it("returns [] when no peaks are found", async () => {
    const treks = await precomputeRegion(PUNE, 150, fetchers({ peaks: async () => [] }));
    expect(treks).toEqual([]);
  });

  it("propagates a fetch failure so the caller can skip the region", async () => {
    await expect(
      precomputeRegion(
        PUNE,
        150,
        fetchers({
          peaks: async () => {
            throw new Error("overpass 504");
          },
        }),
      ),
    ).rejects.toThrow(/overpass/);
  });
});

describe("dedupeAgainstCurated", () => {
  const mk = (id: string, lat: number, lng: number, tier: Trek["tier"]): Trek => ({
    id,
    name: id,
    lat,
    lng,
    cityId: "bangalore",
    tier,
    sources: tier === "curated" ? ["https://x"] : [],
    verified: tier === "curated",
  });

  it("drops a discovery peak that sits on top of a curated trek", () => {
    const curated = [mk("skandagiri", 13.5021, 77.6911, "curated")];
    const discovery = [
      mk("osm-1--bangalore", 13.5022, 77.6912, "discovery"), // ~15 m away → same summit
      mk("osm-2--bangalore", 13.9, 77.9, "discovery"), // far → a genuine new peak
    ];
    const out = dedupeAgainstCurated(discovery, curated);
    expect(out.map((t) => t.id)).toEqual(["osm-2--bangalore"]);
  });

  it("keeps everything when there are no curated treks", () => {
    const discovery = [mk("osm-1--pune", 18.5, 73.8, "discovery")];
    expect(dedupeAgainstCurated(discovery, [])).toHaveLength(1);
  });
});

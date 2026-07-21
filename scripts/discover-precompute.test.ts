import { describe, it, expect } from "vitest";
import {
  precomputeRegion,
  dedupeAgainstCurated,
  enrichCuratedTerrain,
  type DiscoverFetchers,
  type RegionConfig,
} from "./discover-precompute";
import { validateTrek, type Origin, type Trek } from "../src/lib/trek";
import type { ParsedPeak } from "../src/lib/overpass";

const PUNE: Origin = { id: "geo:18.5204,73.8567", name: "Pune", lat: 18.5204, lng: 73.8567 };
const CFG: RegionConfig = { radiusKm: 150, maxCandidates: 60, enrichLimit: 40 };

// A rugged, undocumented peak and a flat, famous one — the point is that
// scoring, not elevation, decides the final rank (every candidate is scored).
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

// Elevations index-aligned to the candidate order (Overpass order = peaks array):
// [ruggedUnknown(center+8 ring), flatFamous(center+8 ring)].
const elevs = [
  1400,
  ...Array<number>(8).fill(1100), // rugged: relief 300, slope ~34° → topo ~1
  1500,
  ...Array<number>(8).fill(1495), // flat: relief 5 → confidence 0 → topo 0
];

const fetchers = (over: Partial<DiscoverFetchers> = {}): DiscoverFetchers => ({
  peaks: async () => [ruggedUnknown, flatFamous],
  elevations: async () => elevs,
  tourismPoints: async () => [],
  ...over,
});

describe("precomputeRegion", () => {
  it("ranks a rugged, undocumented peak above a flat, famous, taller one", async () => {
    const treks = await precomputeRegion(PUNE, fetchers(), CFG);
    expect(treks).toHaveLength(2);
    expect(treks[0].name).toBe("Rugged Unknown");
    expect(treks[0].discoveryScore!).toBeGreaterThan(treks[1].discoveryScore!);
  });

  it("emits valid discovery-tier treks scoped to the region", async () => {
    const [top] = await precomputeRegion(PUNE, fetchers(), CFG);
    expect(validateTrek(top).ok).toBe(true);
    expect(top.tier).toBe("discovery");
    expect(top.verified).toBe(false);
    expect(top.cityId).toBe(PUNE.id);
    expect(top.id).toBe("osm-1--pune"); // region-suffixed id keeps regions unique
    expect(top.sources[0]).toContain("openstreetmap.org/node/1");
  });

  it("computes and rounds the terrain fields + estimated difficulty", async () => {
    const [top] = await precomputeRegion(PUNE, fetchers(), CFG);
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
    const single = await precomputeRegion(
      PUNE,
      {
        peaks: async () => [withProm],
        elevations: async () => [1400, ...Array<number>(8).fill(1100)], // DEM proxy would be 300
        tourismPoints: async () => [],
      },
      CFG,
    );
    expect(single[0].prominenceProxyM).toBe(555);
  });

  it("enriches the kept peaks with a photo, summary, and nearest town", async () => {
    const [top] = await precomputeRegion(
      PUNE,
      fetchers({
        enrich: async () => ({
          image: { url: "https://upload.wikimedia.org/x.jpg", attribution: "Commons" },
          highlights: "A quiet ridge above the valley.",
          nearestTown: "Lonavala",
        }),
      }),
      CFG,
    );
    expect(top.image?.url).toContain("upload.wikimedia.org");
    expect(top.highlights).toBe("A quiet ridge above the valley.");
    expect(top.nearestTown).toBe("Lonavala");
    expect(validateTrek(top).ok).toBe(true);
  });

  it("refuses to emit a region when elevations misalign with sample points", async () => {
    await expect(
      precomputeRegion(PUNE, fetchers({ elevations: async () => [1400, 1100] }), CFG),
    ).rejects.toThrow(/misaligned/);
  });

  it("returns [] when no peaks are found", async () => {
    const treks = await precomputeRegion(PUNE, fetchers({ peaks: async () => [] }), CFG);
    expect(treks).toEqual([]);
  });

  it("propagates a fetch failure so the caller can skip the region", async () => {
    await expect(
      precomputeRegion(
        PUNE,
        fetchers({
          peaks: async () => {
            throw new Error("overpass 504");
          },
        }),
        CFG,
      ),
    ).rejects.toThrow(/overpass/);
  });
});

describe("enrichCuratedTerrain", () => {
  const curated: Trek = {
    id: "skandagiri",
    name: "Skandagiri",
    lat: 13.5021,
    lng: 77.6911,
    cityId: "bangalore",
    tier: "curated",
    elevationM: 1350,
    difficulty: "Moderate",
    sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
    verified: true,
  };

  it("attaches relief/slope/prominence without touching curated difficulty/verification", async () => {
    const [out] = await enrichCuratedTerrain(
      [curated],
      async () => [1350, ...Array<number>(8).fill(1100)], // relief 250
    );
    expect(out.reliefM).toBe(250);
    expect(out.prominenceProxyM).toBe(250);
    expect(out.difficulty).toBe("Moderate"); // unchanged
    expect(out.discoveryScore).toBeUndefined(); // curated never gets a gem score
    expect(out.verified).toBe(true);
  });

  it("leaves a trek unchanged when the DEM can't resolve relief", async () => {
    const [out] = await enrichCuratedTerrain(
      [curated],
      async () => Array<number>(9).fill(1350), // flat → relief 0
    );
    expect(out.reliefM).toBeUndefined();
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

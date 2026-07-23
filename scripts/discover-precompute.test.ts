import { describe, it, expect } from "vitest";
import {
  precomputeRegion,
  dedupeAgainstCurated,
  enrichCuratedTerrain,
  mergeManualPeaks,
  toListedTreks,
  type DiscoverFetchers,
  type RegionConfig,
} from "./discover-precompute";
import type { GeonamesSummit } from "./sources/geonames";
import { manualPeaksNear, MANUAL_PEAKS } from "./seed/manual-peaks";
import { validateTrek, type Origin, type Trek } from "../src/lib/trek";
import type { ParsedPeak } from "../src/lib/overpass";

const PUNE: Origin = { id: "geo:18.5204,73.8567", name: "Pune", lat: 18.5204, lng: 73.8567 };
const CFG: RegionConfig = { radiusKm: 150, maxCandidates: 60, enrichLimit: 40, trailLimit: 40 };

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

  it("attaches a trail + POIs from the trailAndPois fetcher to top peaks (spec 14/15)", async () => {
    const [top] = await precomputeRegion(
      PUNE,
      fetchers({
        trailAndPois: async () => ({
          trail: {
            coords: [
              [18.51, 73.84],
              [18.52, 73.85],
            ],
            lengthKm: 1.2,
            gainM: 80,
            profile: [700, 780],
          },
          pois: [{ kind: "parking", lat: 18.5, lng: 73.83, distM: 600 }],
        }),
      }),
      CFG,
    );
    expect(top.trail?.lengthKm).toBe(1.2);
    expect(top.trail?.gainM).toBe(80);
    expect(top.pois?.[0].kind).toBe("parking");
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

describe("manual peaks (spec 12)", () => {
  const manual: ParsedPeak = {
    id: "manual-puligundu",
    name: "Puligundu",
    lat: 13.3417,
    lng: 79.2032,
    notability: { hasWikipediaTag: false, hasWikidataTag: false },
    sourceUrl: "https://www.openstreetmap.org/#map=16/13.3417/79.2032",
    note: "A granite rock hill near Chittoor.",
  };

  it("mergeManualPeaks puts manual first and drops an OSM duplicate within 200 m", () => {
    const osmDup: ParsedPeak = { ...manual, id: "osm-99", sourceUrl: undefined, note: undefined };
    const osmFar: ParsedPeak = {
      id: "osm-1",
      name: "Far",
      lat: 13.9,
      lng: 79.9,
      notability: { hasWikipediaTag: false, hasWikidataTag: false },
    };
    const merged = mergeManualPeaks([manual], [osmDup, osmFar]);
    expect(merged.map((p) => p.id)).toEqual(["manual-puligundu", "osm-1"]);
  });

  it("manualPeaksNear returns in-range entries mapped to ParsedPeak", () => {
    const near = manualPeaksNear(
      { id: "bangalore", name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
      500,
    );
    expect(near.find((p) => p.id === "manual-puligundu")).toBeTruthy();
    // Out of range at 10 km.
    expect(manualPeaksNear({ id: "x", name: "x", lat: 12.9716, lng: 77.5946 }, 10)).toHaveLength(0);
  });

  it("seeds Puligundu with a known coordinate", () => {
    const p = MANUAL_PEAKS.find((m) => m.id === "manual-puligundu")!;
    expect(p.lat).toBeCloseTo(13.3417, 3);
    expect(p.lng).toBeCloseTo(79.2032, 3);
  });

  it("a manual candidate becomes a discovery Trek carrying its source + note", async () => {
    const [trek] = await precomputeRegion(
      { id: "bangalore", name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
      {
        peaks: async () => [],
        manualPeaks: () => [manual],
        elevations: async () => [1000, ...Array<number>(8).fill(700)], // relief 300
        tourismPoints: async () => [],
      },
      { radiusKm: 500, maxCandidates: 20000, enrichLimit: 0, trailLimit: 0 },
    );
    expect(trek.name).toBe("Puligundu");
    expect(trek.tier).toBe("discovery");
    expect(trek.reliefM).toBe(300);
    expect(trek.highlights).toContain("granite");
    expect(trek.sources[0]).toContain("openstreetmap.org");
    expect(validateTrek(trek).ok).toBe(true);
  });

  it("always enriches a manual peak (photo/town) even below enrichLimit, keeping its note", async () => {
    const [trek] = await precomputeRegion(
      { id: "bangalore", name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
      {
        peaks: async () => [],
        manualPeaks: () => [manual],
        elevations: async () => [1000, ...Array<number>(8).fill(700)],
        tourismPoints: async () => [],
        enrich: async () => ({
          image: { url: "https://upload.wikimedia.org/x.jpg", attribution: "Commons" },
          highlights: "auto summary that must NOT overwrite the manual note",
          nearestTown: "Chittoor",
        }),
      },
      { radiusKm: 500, maxCandidates: 20000, enrichLimit: 0, trailLimit: 0 }, // rank-0 enrichment, yet manual still enriched
    );
    expect(trek.image?.url).toContain("upload.wikimedia.org");
    expect(trek.nearestTown).toBe("Chittoor");
    expect(trek.highlights).toContain("granite"); // manual note preserved
  });
});

describe("GeoNames listed summits (spec 16)", () => {
  const scored: Trek = {
    id: "osm-1--pune",
    name: "Scored Peak",
    lat: 18.51,
    lng: 73.84,
    cityId: "geo:18.5204,73.8567",
    tier: "discovery",
    discoveryScore: 0.8,
    reliefM: 300,
    estimatedDifficulty: "Hard",
    sources: ["https://www.openstreetmap.org/node/1"],
    verified: false,
  };
  const summit: GeonamesSummit = {
    id: "12345",
    name: "Listed Hill",
    lat: 18.7,
    lng: 74.0,
    elevationM: 900,
  };

  it("maps a summit to an unscored listed discovery trek (name + elevation, no topo fields)", () => {
    const [t] = toListedTreks([summit], [], "pune", "geo:18.5204,73.8567");
    expect(t.id).toBe("gn-12345--pune");
    expect(t.name).toBe("Listed Hill");
    expect(t.elevationM).toBe(900);
    expect(t.tier).toBe("discovery");
    expect(t.verified).toBe(false);
    expect(t.sources[0]).toBe("https://www.geonames.org/12345");
    // Listed pins are NOT topo-scored — these must be absent so filters/UI treat
    // them as unranked (and hidden-gems/relief filters exclude them).
    expect(t.discoveryScore).toBeUndefined();
    expect(t.reliefM).toBeUndefined();
    expect(t.estimatedDifficulty).toBeUndefined();
    expect(validateTrek(t).ok).toBe(true);
  });

  it("carries DEM-scored fields (spec 17) so the pin ranks like an OSM peak", () => {
    const [t] = toListedTreks(
      [
        {
          ...summit,
          reliefM: 320,
          prominenceProxyM: 300,
          meanSlopeDeg: 18.5,
          terrainConfidence: 0.9,
          discoveryScore: 0.82,
          estimatedDifficulty: "Moderate",
        },
      ],
      [],
      "pune",
      "c",
    );
    expect(t.reliefM).toBe(320);
    expect(t.meanSlopeDeg).toBe(18.5);
    expect(t.discoveryScore).toBe(0.82);
    expect(t.estimatedDifficulty).toBe("Moderate");
    expect(validateTrek(t).ok).toBe(true);
  });

  it("omits elevationM when GeoNames had none", () => {
    const [t] = toListedTreks(
      [{ id: "9", name: "No Elev", lat: 18.7, lng: 74.0 }],
      [],
      "pune",
      "c",
    );
    expect(t.elevationM).toBeUndefined();
    expect(validateTrek(t).ok).toBe(true);
  });

  it("drops a summit that duplicates an already-scored peak (within 250 m)", () => {
    const dup: GeonamesSummit = { id: "77", name: "Dup", lat: 18.5101, lng: 73.8401 };
    expect(toListedTreks([dup], [scored], "pune", "c")).toHaveLength(0);
  });

  it("dedupes listed summits against each other", () => {
    const a: GeonamesSummit = { id: "1", name: "A", lat: 18.7, lng: 74.0 };
    const b: GeonamesSummit = { id: "2", name: "B", lat: 18.7001, lng: 74.0001 }; // ~15 m away
    expect(toListedTreks([a, b], [], "pune", "c").map((t) => t.id)).toEqual(["gn-1--pune"]);
  });

  it("precomputeRegion appends listed summits below the ranked peaks", async () => {
    const treks = await precomputeRegion(PUNE, fetchers({ listedSummits: () => [summit] }), CFG);
    // 2 scored (rugged, flat) + 1 listed, listed last (no score).
    expect(treks).toHaveLength(3);
    const listed = treks[treks.length - 1];
    expect(listed.id).toBe("gn-12345--pune");
    expect(listed.discoveryScore).toBeUndefined();
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

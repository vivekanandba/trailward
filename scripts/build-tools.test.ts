import { describe, it, expect } from "vitest";
import { pickVolumes } from "./build-gazetteer";
import { pickTargets, matchHeritage } from "./build-hillfeatures";
import { filterUnknown, buildIndiaMask, inIndia } from "./build-detect";
import { featuresNear } from "./build-names";
import { regionFreeId, mergeDuplicates } from "./migrate-region-free";
import { cellsFor } from "./build-climate";
import { pickAltNames } from "./geonames/build-geonames";
import type { Trek } from "../src/lib/trek";
import { climateCellKey } from "../src/lib/climate";

// Pure selection helpers of the hand-run build tools. The tools' network shells
// are exercised by running them; these lock in *what they choose to fetch*,
// which is where the cost and the correctness live.

describe("pickVolumes (gazetteer)", () => {
  it("prefers southern provincial series and alphabetical spans", () => {
    const docs = [
      { identifier: "old", title: "Imperial Gazetteer Of India Vol Ii(1885)" },
      { identifier: "madras", title: "Imperial Gazetteer of India Provincial Series Madras" },
      { identifier: "span", title: "The Imperial Gazetteer Of India Vol-xx Pardi To Pusad" },
    ];
    expect(pickVolumes(docs)[0]).toBe("madras");
    expect(pickVolumes(docs).indexOf("span")).toBeLessThan(pickVolumes(docs).indexOf("old"));
  });

  it("drops entries missing an identifier or title, and honours the cap", () => {
    const docs = [
      { identifier: "a", title: "Imperial Gazetteer of India Vol 1" },
      { identifier: "b" },
      { title: "no id" },
    ];
    expect(pickVolumes(docs)).toEqual(["a"]);
    expect(
      pickVolumes(
        [...Array(30)].map((_, i) => ({ identifier: `v${i}`, title: "Vol" })),
        5,
      ),
    ).toHaveLength(5);
  });
});

const mk = (over: Partial<Trek> & Pick<Trek, "id">): Trek => ({
  name: over.id,
  lat: 13,
  lng: 77,
  cityId: "bangalore",
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

describe("pickTargets (hill features)", () => {
  it("always includes curated treks and anything with a trail or POIs", () => {
    const treks = [
      mk({ id: "cur", tier: "curated", verified: true, sources: ["https://x"] }),
      mk({ id: "withPois", pois: [{ kind: "parking", lat: 13, lng: 77, distM: 10 }] }),
      mk({ id: "plain" }),
    ];
    const ids = pickTargets(treks, 0).map((t) => t.id);
    expect(ids).toContain("cur");
    expect(ids).toContain("withPois");
    expect(ids).not.toContain("plain");
  });

  it("adds the top-scoring discovery peak per 1° cell, without duplicating", () => {
    const treks = [
      mk({ id: "hi", discoveryScore: 0.9 }),
      mk({ id: "lo", discoveryScore: 0.1 }), // same cell as "hi" → loses
      mk({ id: "other", lat: 18.5, lng: 73.9, discoveryScore: 0.5 }), // its own cell
    ];
    const ids = pickTargets(treks, 6).map((t) => t.id);
    expect(ids).toContain("hi");
    expect(ids).toContain("other");
    expect(ids).not.toContain("lo");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cellsFor (climate)", () => {
  it("returns one sample point per distinct grid cell, at the cell centre", () => {
    const treks = [
      mk({ id: "a", lat: 13.01, lng: 77.01 }),
      mk({ id: "b", lat: 13.02, lng: 77.02 }),
    ];
    const cells = cellsFor(treks);
    expect(cells).toHaveLength(1); // same 0.25° cell
    expect(cells[0].key).toBe(climateCellKey(13.01, 77.01));
    // Centre of the cell, so the sample represents the whole cell.
    expect(cells[0].lat).toBeCloseTo(13.125, 3);
    expect(cells[0].lng).toBeCloseTo(77.125, 3);
  });

  it("separates treks in different cells", () => {
    expect(
      cellsFor([mk({ id: "a", lat: 13, lng: 77 }), mk({ id: "b", lat: 14, lng: 78 })]),
    ).toHaveLength(2);
  });
});

describe("pickVolumes tolerates archive.org's multi-valued title field", () => {
  it("accepts a title returned as an array of strings", () => {
    const docs = [
      { identifier: "arr", title: ["Imperial Gazetteer of India", "Provincial Series Madras"] },
      { identifier: "str", title: "Imperial Gazetteer Of India Vol Ii(1885)" },
    ];
    // The array-titled Madras volume must both survive and outrank the 1885 one.
    expect(pickVolumes(docs)).toEqual(["arr", "str"]);
  });

  it("ignores a title of an unexpected type instead of throwing", () => {
    expect(() => pickVolumes([{ identifier: "x", title: 42 }])).not.toThrow();
    expect(pickVolumes([{ identifier: "x", title: 42 }])).toEqual([]);
  });
});

describe("matchHeritage (spec 24)", () => {
  const t = mk({ id: "x", lat: 13.3702, lng: 77.5758 });
  it("matches the nearest designation within 600 m and rejects farther ones", () => {
    expect(
      matchHeritage(t, [{ lat: 13.3705, lng: 77.576, status: "Monument of National Importance" }]),
    ).toBe("Monument of National Importance");
    expect(matchHeritage(t, [{ lat: 13.4, lng: 77.6, status: "Too Far" }])).toBeUndefined();
  });
});

describe("pickAltNames (spec 25)", () => {
  it("keeps distinct Latin variants, dropping the primary and near-duplicates", () => {
    expect(pickAltNames("West Hill", "Conollys Hill,West Hill,Wèst Hîll,ವೆಸ್ಟ್ ಹಿಲ್")).toEqual([
      "Conollys Hill",
    ]);
  });

  it("caps the list and skips over-long or empty candidates", () => {
    const raw = ["A Peak", "B Peak", "C Peak", "D Peak", "", "x".repeat(50)].join(",");
    expect(pickAltNames("Primary", raw, 3)).toEqual(["A Peak", "B Peak", "C Peak"]);
  });

  it("returns [] for an empty column", () => {
    expect(pickAltNames("Name", "")).toEqual([]);
  });
});

describe("filterUnknown (spec 27 — named databases win)", () => {
  const peak = { lat: 13.0, lng: 77.0, elevationM: 900, reliefM: 200 };
  it("drops a candidate within 400 m of an existing pin and keeps distant ones", () => {
    expect(filterUnknown([peak], [{ lat: 13.002, lng: 77.001 }])).toHaveLength(0);
    expect(filterUnknown([peak], [{ lat: 13.05, lng: 77.05 }])).toHaveLength(1);
    expect(filterUnknown([peak], [])).toHaveLength(1);
  });
});

describe("featuresNear (build-names grid)", () => {
  it("returns features from the 3×3 neighbourhood buckets only", () => {
    const CELL = 0.012;
    const grid = new Map([
      [
        `${Math.floor(13.0 / CELL)}:${Math.floor(77.0 / CELL)}`,
        [{ name: "Near RF", code: "RESF", lat: 13.0, lng: 77.0 }],
      ],
      [
        `${Math.floor(14.0 / CELL)}:${Math.floor(78.0 / CELL)}`,
        [{ name: "Far RF", code: "RESF", lat: 14.0, lng: 78.0 }],
      ],
    ]);
    const near = featuresNear(grid, 13.0, 77.0).map((f) => f.name);
    expect(near).toContain("Near RF");
    expect(near).not.toContain("Far RF");
  });
});

describe("region-free migration helpers (spec 30)", () => {
  it("regionFreeId strips per-region suffixes, leaves curated slugs alone", () => {
    expect(regionFreeId("gn-11252043--bengaluru")).toBe("gn-11252043");
    expect(regionFreeId("d12-2947-1901-246-99--bengaluru")).toBe("d12-2947-1901-246-99");
    expect(regionFreeId("osm-123--pune")).toBe("osm-123");
    expect(regionFreeId("skandagiri")).toBe("skandagiri");
  });

  it("mergeDuplicates unions enrichment and prefers a real name over a placeholder", () => {
    const a = mk({ id: "d12-1--x", name: "Unnamed peak (~500 m)", bestSeason: "Dec–Apr (driest)" });
    const b = mk({
      id: "d12-1--y",
      name: "Bilikal Betta",
      landCover: "Forest",
      highlights: "via issue #3",
    });
    const merged = mergeDuplicates([a, b]);
    expect(merged.name).toBe("Bilikal Betta");
    expect(merged.bestSeason).toBe("Dec–Apr (driest)");
    expect(merged.landCover).toBe("Forest");
    expect(merged.cityId).toBeUndefined(); // discovery pins are nationwide now
  });
});

describe("India mask (spec 30 — detection must not surface neighbours' peaks)", () => {
  it("keeps summits near Indian features and drops those far from any", () => {
    const mask = buildIndiaMask([
      { lat: 12.97, lng: 77.59 },
      { lat: 32.2, lng: 77.18 },
    ]);
    expect(inIndia({ lat: 12.99, lng: 77.61 }, mask)).toBe(true); // beside Bengaluru
    expect(inIndia({ lat: 32.21, lng: 77.19 }, mask)).toBe(true); // Himachal
    expect(inIndia({ lat: 28.0, lng: 84.0 }, mask)).toBe(false); // central Nepal
    expect(inIndia({ lat: 36.0, lng: 68.35 }, mask)).toBe(false); // Hindu Kush
  });
});

import { describe, it, expect } from "vitest";
import { DEFAULT_FILTERS, applyFilters, countByDifficulty, type FilterState } from "./filters";
import { DEFAULT_ORIGIN, type Trek } from "./trek";

const origin = DEFAULT_ORIGIN;

// Build a trek with sensible defaults; override per test. distanceKm is set
// explicitly so radius boundaries are exact (no haversine float fuzz).
function trek(over: Partial<Trek>): Trek {
  return {
    id: over.id ?? "t",
    name: over.name ?? "Trek",
    lat: 13,
    lng: 77,
    cityId: "bangalore",
    tier: "curated",
    sources: ["https://x"],
    verified: true,
    ...over,
  };
}

const filters = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTERS, ...over });

describe("DEFAULT_FILTERS", () => {
  it("returns the full set (no constraints active)", () => {
    const all = [trek({ id: "a", distanceKm: 10 }), trek({ id: "b", distanceKm: 20 })];
    expect(applyFilters(all, origin, DEFAULT_FILTERS)).toHaveLength(2);
  });

  it("has a 100 km default radius", () => {
    expect(DEFAULT_FILTERS.radiusKm).toBe(100);
  });
});

describe("applyFilters — radius", () => {
  const treks = [trek({ id: "near", distanceKm: 50 })];

  it("includes a trek exactly at the radius boundary", () => {
    expect(applyFilters(treks, origin, filters({ radiusKm: 50 }))).toHaveLength(1);
  });

  it("excludes a trek just beyond the radius", () => {
    expect(applyFilters(treks, origin, filters({ radiusKm: 49.999 }))).toHaveLength(0);
  });

  it("falls back to haversine when distanceKm is absent", () => {
    const far = [trek({ id: "far", lat: 0, lng: 0 })]; // ~1500 km+ from Bengaluru
    expect(applyFilters(far, origin, filters({ radiusKm: 100 }))).toHaveLength(0);
  });
});

describe("applyFilters — AND composition", () => {
  it("requires all active filters to pass", () => {
    const treks = [
      trek({ id: "match", distanceKm: 30, difficulty: "Easy", nightTrek: true }),
      trek({ id: "wrong-diff", distanceKm: 30, difficulty: "Hard", nightTrek: true }),
      trek({ id: "no-night", distanceKm: 30, difficulty: "Easy", nightTrek: false }),
      trek({ id: "too-far", distanceKm: 200, difficulty: "Easy", nightTrek: true }),
    ];
    const out = applyFilters(
      treks,
      origin,
      filters({ radiusKm: 60, difficulties: ["Easy"], nightOnly: true }),
    );
    expect(out.map((t) => t.id)).toEqual(["match"]);
  });
});

describe("applyFilters — difficulty (unknown excluded only when active)", () => {
  const treks = [
    trek({ id: "easy", distanceKm: 1, difficulty: "Easy" }),
    trek({ id: "unknown", distanceKm: 1 }), // no difficulty (discovery-like)
  ];

  it("shows unknowns when no difficulty filter is set", () => {
    expect(applyFilters(treks, origin, filters()).map((t) => t.id)).toEqual(["easy", "unknown"]);
  });

  it("excludes unknowns when a difficulty filter is active", () => {
    const out = applyFilters(treks, origin, filters({ difficulties: ["Easy"] }));
    expect(out.map((t) => t.id)).toEqual(["easy"]);
  });
});

describe("applyFilters — elevation range (inclusive bounds)", () => {
  const treks = [
    trek({ id: "low", distanceKm: 1, elevationM: 800 }),
    trek({ id: "mid", distanceKm: 1, elevationM: 1200 }),
    trek({ id: "high", distanceKm: 1, elevationM: 1600 }),
    trek({ id: "noele", distanceKm: 1 }),
  ];

  it("keeps treks within [min,max] inclusive and excludes unknowns when active", () => {
    const out = applyFilters(treks, origin, filters({ elevation: [1200, 1600] }));
    expect(out.map((t) => t.id)).toEqual(["mid", "high"]);
  });
});

describe("applyFilters — types (intersection, unknown excluded when active)", () => {
  const treks = [
    trek({ id: "hill", distanceKm: 1, type: ["Hill"] }),
    trek({ id: "fort", distanceKm: 1, type: ["Fort", "Hill"] }),
    trek({ id: "cave", distanceKm: 1, type: ["Cave"] }),
    trek({ id: "untyped", distanceKm: 1 }),
  ];

  it("matches treks sharing any selected type", () => {
    const out = applyFilters(treks, origin, filters({ types: ["Hill"] }));
    expect(out.map((t) => t.id)).toEqual(["hill", "fort"]);
  });
});

describe("applyFilters — night, permit, duration, trail length", () => {
  it("nightOnly keeps only night treks", () => {
    const treks = [
      trek({ id: "night", distanceKm: 1, nightTrek: true }),
      trek({ id: "day", distanceKm: 1, nightTrek: false }),
    ];
    expect(applyFilters(treks, origin, filters({ nightOnly: true })).map((t) => t.id)).toEqual([
      "night",
    ]);
  });

  it("permitRequired matches exactly when set", () => {
    const treks = [
      trek({ id: "permit", distanceKm: 1, permitRequired: true }),
      trek({ id: "free", distanceKm: 1, permitRequired: false }),
    ];
    expect(
      applyFilters(treks, origin, filters({ permitRequired: false })).map((t) => t.id),
    ).toEqual(["free"]);
  });

  it("durationMaxHrs uses the upper bound of the duration range", () => {
    const treks = [
      trek({ id: "short", distanceKm: 1, durationHrs: "2–3" }),
      trek({ id: "long", distanceKm: 1, durationHrs: "5–6" }),
    ];
    expect(applyFilters(treks, origin, filters({ durationMaxHrs: 4 })).map((t) => t.id)).toEqual([
      "short",
    ]);
  });

  it("trailLengthMaxKm keeps treks at or under the cap", () => {
    const treks = [
      trek({ id: "tiny", distanceKm: 1, trailLengthKm: 3 }),
      trek({ id: "big", distanceKm: 1, trailLengthKm: 12 }),
    ];
    expect(applyFilters(treks, origin, filters({ trailLengthMaxKm: 5 })).map((t) => t.id)).toEqual([
      "tiny",
    ]);
  });
});

describe("applyFilters — free-text query", () => {
  const treks = [
    trek({ id: "a", distanceKm: 1, name: "Skandagiri", nearestTown: "Chikkaballapur" }),
    trek({ id: "b", distanceKm: 1, name: "Nandi Hills", nearestTown: "Nandi" }),
  ];

  it("matches the name case-insensitively and trims whitespace", () => {
    expect(applyFilters(treks, origin, filters({ query: "  skanda " })).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("matches the nearest town", () => {
    expect(applyFilters(treks, origin, filters({ query: "chikka" })).map((t) => t.id)).toEqual([
      "a",
    ]);
  });
});

describe("countByDifficulty", () => {
  it("tallies each difficulty and ignores unknowns", () => {
    const treks = [
      trek({ id: "1", difficulty: "Easy" }),
      trek({ id: "2", difficulty: "Easy" }),
      trek({ id: "3", difficulty: "Hard" }),
      trek({ id: "4" }),
    ];
    expect(countByDifficulty(treks)).toEqual({ Easy: 2, Moderate: 0, Hard: 1 });
  });
});

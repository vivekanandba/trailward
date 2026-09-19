import { describe, it, expect } from "vitest";
import { GUIDED_PATHS, applyPath } from "./paths";
import { DEFAULT_FILTERS, applyFilters } from "./filters";
import type { Trek, Origin } from "./trek";

const origin: Origin = { id: "b", name: "Bengaluru", lat: 12.9716, lng: 77.5946 };

const trek = (over: Partial<Trek> & Pick<Trek, "id" | "name">): Trek => ({
  lat: 12.98,
  lng: 77.6,
  tier: "discovery",
  sources: [],
  verified: false,
  distanceKm: 5,
  ...over,
});

describe("GUIDED_PATHS (spec 38)", () => {
  it("every path has an id, a label, a reason, and a filter preset", () => {
    expect(GUIDED_PATHS.length).toBeGreaterThanOrEqual(3);
    for (const p of GUIDED_PATHS) {
      expect(p.id, p.label).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.reason.length, p.label).toBeGreaterThan(10); // a real sentence
      expect(Object.keys(p.filters).length, p.label).toBeGreaterThan(0);
    }
  });

  it("path ids are unique", () => {
    expect(new Set(GUIDED_PATHS.map((p) => p.id)).size).toBe(GUIDED_PATHS.length);
  });

  it("applyPath produces a valid FilterState built on the defaults", () => {
    for (const p of GUIDED_PATHS) {
      const next = applyPath(DEFAULT_FILTERS, p);
      // Never leaves a field undefined that the default defines.
      expect(typeof next.radiusKm, p.label).toBe("number");
      expect(Array.isArray(next.difficulties), p.label).toBe(true);
      expect(typeof next.query, p.label).toBe("string");
    }
  });

  it("applying a path equals setting those filters by hand — nothing hidden", () => {
    const path = GUIDED_PATHS[0];
    expect(applyPath(DEFAULT_FILTERS, path)).toEqual({ ...DEFAULT_FILTERS, ...path.filters });
  });

  it("a path starts from the DEFAULTS, so switching paths never compounds", () => {
    const [a, b] = GUIDED_PATHS;
    const viaA = applyPath(applyPath(DEFAULT_FILTERS, a), b);
    expect(viaA).toEqual(applyPath(DEFAULT_FILTERS, b));
  });

  it("each path actually narrows a mixed result set", () => {
    const treks: Trek[] = [
      trek({ id: "easy", name: "Easy Hill", difficulty: "Easy", reliefM: 120 }),
      trek({ id: "hard", name: "Hard Hill", difficulty: "Hard", reliefM: 700 }),
      trek({ id: "night", name: "Night Hill", difficulty: "Moderate", nightTrek: true }),
      trek({ id: "gem", name: "Gem Hill", discoveryScore: 0.95, reliefM: 400 }),
      trek({ id: "unnamed", name: "Unnamed peak (~900 m)", reliefM: 50 }),
    ];
    const all = applyFilters(treks, origin, DEFAULT_FILTERS).length;
    for (const p of GUIDED_PATHS) {
      const got = applyFilters(treks, origin, applyPath(DEFAULT_FILTERS, p)).length;
      expect(got, `${p.label} should narrow ${all}`).toBeLessThan(all);
    }
  });
});

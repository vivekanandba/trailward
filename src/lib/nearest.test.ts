import { describe, it, expect } from "vitest";
import { bestMatch, nearestNames, similarity } from "./nearest";

// Spec 44 R10, R12: when nothing matches, offer what probably was meant, and
// say nothing when that is a guess.
describe("similarity", () => {
  it("is 1 for the same text, folded", () => {
    expect(similarity("Kumāra Parvatha", "kumara parvatha")).toBe(1);
  });

  it("is high for a one-letter slip and low for a different word", () => {
    expect(similarity("skandagri", "skandagiri")).toBeGreaterThan(0.85);
    expect(similarity("skandagiri", "savandurga")).toBeLessThan(0.6);
  });
});

describe("nearestNames", () => {
  const names = ["Skandagiri", "Savandurga", "Nandi Hills", "Kumara Parvatha", "Makalidurga"];

  it("offers the closest names above the floor, best first", () => {
    expect(nearestNames("skandagri", names)).toEqual(["Skandagiri"]);
    expect(nearestNames("makalidurg", names, { max: 2 })[0]).toBe("Makalidurga");
  });

  it("offers nothing when nothing is close", () => {
    expect(nearestNames("xyzzy", names)).toEqual([]);
  });

  it("caps the list", () => {
    expect(
      nearestNames("durga", ["Adurga", "Bdurga", "Cdurga", "Ddurga"], { max: 2, floor: 0.5 }),
    ).toHaveLength(2);
  });
});

describe("bestMatch — one confident answer or none", () => {
  it("returns the single clear best", () => {
    expect(bestMatch("kumara-parvata", ["kumara-parvatha", "skandagiri"])).toBe("kumara-parvatha");
  });

  it("refuses a tie: two equally close answers mean we do not know which", () => {
    // Both 0.875 similar — above the floor, so only the tie rule can refuse.
    expect(similarity("nandi-hills-gn", "nandi-hills-gn-1")).toBeGreaterThan(0.75);
    expect(bestMatch("nandi-hills-gn", ["nandi-hills-gn-1", "nandi-hills-gn-2"])).toBeUndefined();
  });

  it("refuses when the best is under the floor", () => {
    expect(bestMatch("abc", ["kumara-parvatha"])).toBeUndefined();
  });
});

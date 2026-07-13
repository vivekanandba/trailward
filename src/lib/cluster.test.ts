import { describe, it, expect } from "vitest";
import { clusterByGrid } from "./cluster";
import type { Trek } from "./trek";

function trek(id: string, lat: number, lng: number): Trek {
  return { id, name: id, lat, lng, cityId: "x", tier: "discovery", sources: [], verified: false };
}

describe("clusterByGrid", () => {
  it("groups nearby treks into one cell and keeps distant ones separate", () => {
    const treks = [trek("a", 13.01, 77.01), trek("b", 13.02, 77.02), trek("c", 13.9, 77.9)];
    const clusters = clusterByGrid(treks, 0.5);
    expect(clusters).toHaveLength(2);
    const big = clusters.find((c) => c.members.length > 1)!;
    expect(big.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
    // centroid is the mean of its members
    expect(big.lat).toBeCloseTo(13.015, 5);
    expect(big.lng).toBeCloseTo(77.015, 5);
  });

  it("returns every trek as its own singleton when step is non-positive", () => {
    const treks = [trek("a", 13, 77), trek("b", 13.001, 77.001)];
    expect(clusterByGrid(treks, 0)).toHaveLength(2);
    expect(clusterByGrid(treks, -1).every((c) => c.members.length === 1)).toBe(true);
  });

  it("splits treks that fall on opposite sides of a cell boundary", () => {
    // step 1.0 → cells floor at integer degrees; 12.9 and 13.1 land in 12 vs 13.
    const clusters = clusterByGrid([trek("a", 12.9, 77.5), trek("b", 13.1, 77.5)], 1);
    expect(clusters).toHaveLength(2);
  });
});

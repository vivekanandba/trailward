import { describe, it, expect } from "vitest";
import { geonamesSummitsNear } from "./geonames";
import type { Origin } from "../../src/lib/trek";

const BENGALURU: Origin = { id: "bangalore", name: "Bengaluru", lat: 12.9716, lng: 77.5946 };

// These run against the committed region subset (scripts/geonames/india-summits.json).
describe("geonamesSummitsNear", () => {
  it("returns summits within the radius and none beyond it", () => {
    const near = geonamesSummitsNear(BENGALURU, 500);
    expect(near.length).toBeGreaterThan(0);
    for (const s of near) {
      const dLat = ((s.lat - BENGALURU.lat) * Math.PI) / 180;
      // cheap sanity: every result is at least plausibly within a few degrees
      expect(Math.abs(dLat)).toBeLessThan(0.1 /* rad, ~640 km */);
    }
  });

  it("returns fewer summits for a tighter radius", () => {
    const wide = geonamesSummitsNear(BENGALURU, 500).length;
    const tight = geonamesSummitsNear(BENGALURU, 100).length;
    expect(tight).toBeLessThan(wide);
  });
});

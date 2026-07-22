import { describe, it, expect } from "vitest";
import { parseTrailWays, pickNearestTrail, simplifyPath, pathLengthKm, buildTrail } from "./trails";

const geomFixture = {
  elements: [
    {
      type: "way",
      geometry: [
        { lat: 13.3418, lon: 79.2033 },
        { lat: 13.3425, lon: 79.204 },
        { lat: 13.343, lon: 79.2046 },
      ],
    },
    {
      type: "way",
      geometry: [
        { lat: 13.5, lon: 79.5 }, // far away
        { lat: 13.51, lon: 79.51 },
      ],
    },
    { type: "way", geometry: [{ lat: 1, lon: 1 }] }, // <2 points → dropped
  ],
};

describe("parseTrailWays", () => {
  it("turns geom ways into polylines and drops sub-2-point ways", () => {
    const ways = parseTrailWays(geomFixture);
    expect(ways).toHaveLength(2);
    expect(ways[0][0]).toEqual([13.3418, 79.2033]);
  });
  it("returns [] for malformed input", () => {
    expect(parseTrailWays({})).toEqual([]);
  });
});

describe("pickNearestTrail", () => {
  const summit = { lat: 13.3417, lng: 79.2032 };
  it("picks the way with a vertex closest to the summit", () => {
    const picked = pickNearestTrail(parseTrailWays(geomFixture), summit);
    expect(picked?.[0]).toEqual([13.3418, 79.2033]);
  });
  it("returns undefined when the nearest way is beyond maxM", () => {
    expect(pickNearestTrail(parseTrailWays(geomFixture), summit, 5)).toBeUndefined();
  });
});

describe("simplifyPath", () => {
  it("never exceeds maxPoints and keeps the endpoints", () => {
    const long: [number, number][] = Array.from({ length: 100 }, (_, i) => [i / 100, 0]);
    const out = simplifyPath(long, 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out[0]).toEqual(long[0]);
    expect(out[out.length - 1]).toEqual(long[long.length - 1]);
  });
  it("returns the input unchanged when already short", () => {
    const short: [number, number][] = [
      [0, 0],
      [1, 1],
    ];
    expect(simplifyPath(short, 30)).toBe(short);
  });
});

describe("pathLengthKm", () => {
  it("sums segment lengths (~1.57 km for a 1° lat step near the equator is too big; use small steps)", () => {
    // Two ~111 m north steps → ~0.222 km.
    const km = pathLengthKm([
      [13.0, 77.0],
      [13.001, 77.0],
      [13.002, 77.0],
    ]);
    expect(km).toBeGreaterThan(0.2);
    expect(km).toBeLessThan(0.25);
  });
});

describe("buildTrail", () => {
  const coords: [number, number][] = [
    [13.0, 77.0],
    [13.001, 77.0],
    [13.002, 77.0],
  ];

  it("sums only positive elevation deltas as gain and records a profile", () => {
    const trail = buildTrail(coords, [900, 950, 930]); // +50, -20 → gain 50
    expect(trail.gainM).toBe(50);
    expect(trail.profile).toEqual([900, 950, 930]);
    expect(trail.lengthKm).toBeGreaterThan(0);
  });

  it("keeps length but drops gain/profile when an elevation is missing", () => {
    const trail = buildTrail(coords, [900, undefined, 930]);
    expect(trail.gainM).toBe(0);
    expect(trail.profile).toBeUndefined();
    expect(trail.lengthKm).toBeGreaterThan(0);
  });
});

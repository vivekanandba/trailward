import { describe, it, expect } from "vitest";
import { distanceFrom } from "./distance";
import { DEFAULT_ORIGIN } from "./trek";

describe("distanceFrom (haversine, km)", () => {
  it("is zero from a point to itself", () => {
    expect(distanceFrom(DEFAULT_ORIGIN, DEFAULT_ORIGIN)).toBeCloseTo(0, 5);
  });

  it("is symmetric", () => {
    const a = { lat: 12.97, lng: 77.59 };
    const b = { lat: 13.5, lng: 77.69 };
    expect(distanceFrom({ ...DEFAULT_ORIGIN, ...a }, b)).toBeCloseTo(
      distanceFrom({ ...DEFAULT_ORIGIN, ...b }, a),
      6,
    );
  });

  it("≈ 111 km per degree of latitude", () => {
    const d = distanceFrom({ ...DEFAULT_ORIGIN, lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("matches a known city pair (Bengaluru → Chennai ≈ 290 km)", () => {
    const chennai = { lat: 13.0827, lng: 80.2707 };
    const d = distanceFrom(DEFAULT_ORIGIN, chennai);
    expect(d).toBeGreaterThan(280);
    expect(d).toBeLessThan(300);
  });
});

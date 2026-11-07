import { describe, it, expect } from "vitest";
import { ROAD_ORIGIN, distanceFrom, formatTrip, tripDistance } from "./distance";
import { DEFAULT_ORIGIN, type Trek } from "./trek";

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

// Spec 05 / spec 44 register row 16: curated treks carry a road distance
// measured from Bengaluru only. From anywhere else it is a wrong number.
describe("tripDistance — a road distance holds only from where it was measured", () => {
  const skandagiri = {
    id: "skandagiri",
    name: "Skandagiri",
    lat: 13.4192,
    lng: 77.6836,
    tier: "curated",
    sources: ["https://x"],
    verified: true,
    distanceKm: 67.6,
    driveTimeMin: 76,
  } as Trek;
  const mysuru = { id: "mysuru", name: "Mysuru", lat: 12.2958, lng: 76.6394 };

  it("uses the baked road distance and drive time from Bengaluru", () => {
    expect(tripDistance(DEFAULT_ORIGIN, skandagiri)).toEqual({
      km: 67.6,
      byRoad: true,
      driveMin: 76,
    });
  });

  it("falls back to the straight line from any other origin", () => {
    const d = tripDistance(mysuru, skandagiri);
    expect(d.byRoad).toBe(false);
    expect(d.driveMin).toBeUndefined();
    expect(d.km).toBeCloseTo(distanceFrom(mysuru, skandagiri), 6);
    expect(d.km).toBeGreaterThan(150); // the bug listed it at 67.6 km
  });

  it("does not trust it from a live location a few hundred metres from the centre", () => {
    const nearby = { ...DEFAULT_ORIGIN, id: "here", lat: 12.975, lng: 77.5946 };
    expect(tripDistance(nearby, skandagiri).byRoad).toBe(false);
  });

  it("trusts it from the same start point restored at URL precision (within 50 m)", () => {
    // An origin read back from a 5-decimal URL is ~1 m off; still the same start.
    const restored = { ...DEFAULT_ORIGIN, lat: DEFAULT_ORIGIN.lat + 0.00001 };
    expect(tripDistance(restored, skandagiri).byRoad).toBe(true);
    const sixtyMetres = { ...DEFAULT_ORIGIN, lat: DEFAULT_ORIGIN.lat + 0.00054 };
    expect(tripDistance(sixtyMetres, skandagiri).byRoad).toBe(false);
  });

  it("is measured from the origin build-data routes from", async () => {
    // The two must not drift apart (CON-COV-003).
    const { BANGALORE_ORIGIN } = await import("../../scripts/seed/bangalore");
    expect(distanceFrom(ROAD_ORIGIN, BANGALORE_ORIGIN)).toBeLessThan(0.001);
  });

  it("uses the straight line when no road distance was measured", () => {
    const peak = { ...skandagiri, distanceKm: undefined, driveTimeMin: undefined };
    expect(tripDistance(DEFAULT_ORIGIN, peak)).toEqual({
      km: distanceFrom(DEFAULT_ORIGIN, peak),
      byRoad: false,
    });
  });
});

describe("formatTrip", () => {
  it("names the kind of distance, and the drive time only when measured", () => {
    expect(formatTrip({ km: 67.6, byRoad: true, driveMin: 76 })).toBe(
      "~68 km by road · 1 h 16 min drive",
    );
    expect(formatTrip({ km: 67.6, byRoad: true, driveMin: 45 })).toBe(
      "~68 km by road · 45 min drive",
    );
    expect(formatTrip({ km: 67.6, byRoad: true, driveMin: 120 })).toBe(
      "~68 km by road · 2 h drive",
    );
    expect(formatTrip({ km: 67.6, byRoad: true })).toBe("~68 km by road");
    // Rounded before splitting: never "1 h 60 min".
    expect(formatTrip({ km: 100, byRoad: true, driveMin: 119.6 })).toBe(
      "~100 km by road · 2 h drive",
    );
    expect(formatTrip({ km: 175.6, byRoad: false })).toBe("~176 km in a straight line");
  });
});

import { describe, it, expect } from "vitest";
import { rosetteRing, computeTerrain, estimateDifficulty, type TerrainMetrics } from "./terrain";
import { distanceFrom } from "./distance";

describe("rosetteRing", () => {
  // id/name satisfy distanceFrom's Origin param; only lat/lng matter here.
  const center = { id: "c", name: "c", lat: 12.9716, lng: 77.5946 };

  it("returns 8 compass points", () => {
    expect(rosetteRing(center, 450)).toHaveLength(8);
  });

  it("places every ring point ~radiusM from the center (all bearings equal distance)", () => {
    for (const p of rosetteRing(center, 450)) {
      const d = distanceFrom(center, p) * 1000; // km → m
      expect(d).toBeGreaterThan(430);
      expect(d).toBeLessThan(470);
    }
  });

  it("scales longitude by 1/cos(lat) so points stay circular away from the equator", () => {
    const [north] = rosetteRing(center, 450); // bearing 0 = due north
    expect(north.lng).toBeCloseTo(center.lng, 6); // north point shares longitude
    expect(north.lat).toBeGreaterThan(center.lat);
  });
});

describe("computeTerrain", () => {
  // A clean cone: summit 1000 m, ring all 800 m, 450 m away.
  const cone = computeTerrain(1000, [800, 800, 800, 800, 800, 800, 800, 800], 450);

  it("relief is max minus min over all samples", () => {
    expect(cone.reliefM).toBe(200);
  });

  it("prominence proxy is summit minus the lowest ring point", () => {
    expect(cone.prominenceProxyM).toBe(200);
  });

  it("clamps prominence proxy to 0 when the center sits below its ring (a dip)", () => {
    const dip = computeTerrain(700, [800, 800, 800, 800, 800, 800, 800, 800], 450);
    expect(dip.prominenceProxyM).toBe(0);
  });

  it("mean slope = atan(drop / radius) in degrees", () => {
    // atan(200/450) = 23.96°
    expect(cone.meanSlopeDeg).toBeCloseTo(23.96, 1);
    expect(cone.maxSlopeDeg).toBeCloseTo(23.96, 1);
  });

  it("TRI is the root-sum-square of ring-vs-center differences", () => {
    // sqrt(8 * 200^2) = 565.7
    expect(cone.tri).toBeCloseTo(565.69, 1);
  });

  it("confidence rises with relief and is ~1 for a prominent hill", () => {
    expect(cone.confidence).toBe(1); // relief 200 → clamp((200-20)/80)=1
  });

  it("confidence is low for a barely-there knoll (DEM noise floor)", () => {
    const knoll = computeTerrain(1010, [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 450);
    expect(knoll.reliefM).toBe(10);
    expect(knoll.confidence).toBe(0); // (10-20)/80 < 0 → clamp 0
  });

  it("returns zeroed metrics with confidence 0 when the center elevation is missing", () => {
    const m = computeTerrain(undefined, [800, 800, 800], 450);
    expect(m.confidence).toBe(0);
    expect(m.reliefM).toBe(0);
    expect(m.prominenceProxyM).toBe(0);
  });

  it("returns confidence 0 when fewer than 3 ring samples are valid", () => {
    const m = computeTerrain(1000, [800, undefined, undefined, undefined], 450);
    expect(m.confidence).toBe(0);
  });

  it("ignores undefined ring samples when computing metrics", () => {
    const m = computeTerrain(1000, [800, undefined, 820, 810, 805], 450);
    expect(m.reliefM).toBe(200); // 1000 - 800
    expect(m.prominenceProxyM).toBe(200);
  });
});

describe("estimateDifficulty", () => {
  const at = (reliefM: number, meanSlopeDeg: number): TerrainMetrics =>
    ({ reliefM, meanSlopeDeg }) as TerrainMetrics;

  it("Easy for gentle, low-relief terrain", () => {
    expect(estimateDifficulty(at(120, 8))).toBe("Easy");
  });

  it("Moderate for mid relief or slope", () => {
    expect(estimateDifficulty(at(400, 14))).toBe("Moderate");
  });

  it("Hard for big relief or steep slope", () => {
    expect(estimateDifficulty(at(900, 20))).toBe("Hard");
    expect(estimateDifficulty(at(200, 30))).toBe("Hard");
  });
});

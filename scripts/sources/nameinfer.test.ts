import { describe, it, expect } from "vitest";
import { stripFeatureSuffix, inferName, type NamerFeature } from "./nameinfer";

describe("stripFeatureSuffix", () => {
  it("recovers the hill name from forest/temple/pass feature names", () => {
    expect(stripFeatureSuffix("Godumalai Reserved Forest")).toBe("Godumalai");
    expect(stripFeatureSuffix("Devarāyadurga State Forest")).toBe("Devarāyadurga");
    expect(stripFeatureSuffix("Uppatti Shola Reserve")).toBe("Uppatti");
    expect(stripFeatureSuffix("Huliyurdurga R.F.")).toBe("Huliyurdurga");
    expect(stripFeatureSuffix("Siddara Betta Temple")).toBe("Siddara Betta");
  });

  it("strips stacked suffixes", () => {
    expect(stripFeatureSuffix("Kalvarayan Reserved Forest Extension")).toBe("Kalvarayan");
  });

  it("keeps pass/ghat names intact enough to be useful", () => {
    expect(stripFeatureSuffix("Nānaghāt")).toBe("Nānaghāt"); // single word, no suffix match
    expect(stripFeatureSuffix("Thal Ghāt")).toBe("Thal");
  });

  it("rejects remainders that are not names", () => {
    expect(stripFeatureSuffix("Reserved Forest")).toBeUndefined();
    expect(stripFeatureSuffix("New Reserve")).toBeUndefined();
    expect(stripFeatureSuffix("No 12 Block")).toBeUndefined();
    expect(stripFeatureSuffix("  ")).toBeUndefined();
  });
});

describe("inferName", () => {
  const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number =>
    Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111;
  const summit = { lat: 13.0, lng: 77.0 };
  const forest: NamerFeature = { name: "Godumalai RF", code: "RESF", lat: 13.003, lng: 77.001 };

  it("names from the nearest qualifying feature", () => {
    const far: NamerFeature = { name: "Other Forest", code: "RESF", lat: 13.006, lng: 77.003 };
    const hit = inferName(summit, [far, forest], km)!;
    expect(hit.name).toBe("Godumalai");
    expect(hit.from).toBe("Godumalai RF");
  });

  it("respects each code's trust radius", () => {
    const temple: NamerFeature = { name: "X Temple", code: "TMPL", lat: 13.006, lng: 77.0 }; // ~0.67 km > 0.5 cap
    expect(inferName(summit, [temple], km)).toBeUndefined();
  });

  it("never names from ordinary villages or unknown codes", () => {
    const village: NamerFeature = { name: "Somehalli", code: "PPL", lat: 13.001, lng: 77.0 };
    expect(inferName(summit, [village], km)).toBeUndefined();
  });

  it("names from a village whose own name is a hill word, kept whole (spec 31)", () => {
    const village: NamerFeature = { name: "Huliyurdurga", code: "PPL", lat: 13.005, lng: 77.0 };
    const hit = inferName(summit, [village], km)!;
    expect(hit.name).toBe("Huliyurdurga");
    expect(hit.from).toBe("Huliyurdurga");
  });

  it("village rule: respects its 1 km radius and loses to an ON-hill feature", () => {
    const farVillage: NamerFeature = { name: "Nandibetta", code: "PPL", lat: 13.011, lng: 77.0 }; // ~1.2 km
    expect(inferName(summit, [farVillage], km)).toBeUndefined();
    const nearVillage: NamerFeature = { name: "Nandibetta", code: "PPL", lat: 13.001, lng: 77.0 };
    // The forest is FARTHER than the village, but on-hill features always win.
    expect(inferName(summit, [nearVillage, forest], km)!.name).toBe("Godumalai");
  });

  it("skips features whose stripped name is empty", () => {
    const bare: NamerFeature = { name: "Reserved Forest", code: "RESF", lat: 13.001, lng: 77.0 };
    expect(inferName(summit, [bare], km)).toBeUndefined();
  });
});

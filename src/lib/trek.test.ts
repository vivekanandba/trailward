import { describe, it, expect } from "vitest";
import { DEFAULT_ORIGIN, isTrek, validateTrek, validateDataset, type Trek } from "./trek";

// A complete curated record — every rich field present.
const curated: Trek = {
  id: "skandagiri",
  name: "Skandagiri",
  lat: 13.5021,
  lng: 77.6911,
  cityId: "bangalore",
  tier: "curated",
  distanceKm: 62,
  driveTimeMin: 90,
  elevationM: 1350,
  trailLengthKm: 5,
  trailType: "round-trip",
  durationHrs: "3–4",
  difficulty: "Moderate",
  type: ["Hill", "Fort"],
  bestSeason: "Oct–Feb",
  permitRequired: true,
  entryFee: "₹250 / head",
  nightTrek: true,
  highlights: "Sunrise above the clouds.",
  nearestTown: "Chikkaballapur",
  image: { url: "https://example.org/skanda.jpg", attribution: "CC BY-SA, Foo" },
  sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
  verified: true,
};

// A minimal discovery record — only the required fields.
const discovery: Trek = {
  id: "osm-peak-123",
  name: "Unnamed Peak",
  lat: 13.1,
  lng: 77.2,
  cityId: "pune",
  tier: "discovery",
  sources: [],
  verified: false,
};

describe("DEFAULT_ORIGIN", () => {
  it("is Bengaluru with valid coords", () => {
    expect(DEFAULT_ORIGIN.id).toBe("bangalore");
    expect(DEFAULT_ORIGIN.lat).toBeCloseTo(12.9716);
    expect(DEFAULT_ORIGIN.lng).toBeCloseTo(77.5946);
  });
});

describe("validateTrek — acceptance", () => {
  it("accepts a complete curated fixture", () => {
    const r = validateTrek(curated);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trek.id).toBe("skandagiri");
  });

  it("accepts a minimal discovery fixture", () => {
    const r = validateTrek(discovery);
    expect(r.ok).toBe(true);
  });

  it("ignores unknown extra fields (forward compatible)", () => {
    const r = validateTrek({ ...curated, futureField: 42 });
    expect(r.ok).toBe(true);
  });

  it("accepts a discovery trek with in-range topography fields", () => {
    const r = validateTrek({
      ...discovery,
      reliefM: 420,
      prominenceProxyM: 300,
      meanSlopeDeg: 22.5,
      terrainConfidence: 1,
      discoveryScore: 0.73,
      estimatedDifficulty: "Moderate",
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateTrek — rejection", () => {
  const cases: Array<[string, unknown]> = [
    ["lat out of range", { ...curated, lat: 91 }],
    ["lng out of range", { ...curated, lng: -181 }],
    ["elevation over 9000", { ...curated, elevationM: 9001 }],
    ["negative distance", { ...curated, distanceKm: -1 }],
    ["missing id", { ...curated, id: "" }],
    ["missing name", { ...curated, name: undefined }],
    ["bad difficulty", { ...curated, difficulty: "Brutal" }],
    ["bad tier", { ...curated, tier: "made-up" }],
    ["relief over 9000", { ...curated, reliefM: 9001 }],
    ["negative prominence proxy", { ...curated, prominenceProxyM: -1 }],
    ["slope over 90", { ...curated, meanSlopeDeg: 91 }],
    ["confidence over 1", { ...curated, terrainConfidence: 1.5 }],
    ["discoveryScore below 0", { ...curated, discoveryScore: -0.1 }],
    ["bad estimatedDifficulty", { ...curated, estimatedDifficulty: "Brutal" }],
  ];

  it.each(cases)("rejects: %s", (_label, input) => {
    const r = validateTrek(input);
    expect(r.ok).toBe(false);
  });

  it("names the offending trek id and field in the error", () => {
    const r = validateTrek({ ...curated, elevationM: 9001 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("skandagiri");
      expect(r.error).toContain("elevationM");
    }
  });
});

describe("validateTrek — tier rules", () => {
  it("rejects a curated trek with empty sources", () => {
    const r = validateTrek({ ...curated, sources: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects a curated trek with verified !== true", () => {
    const r = validateTrek({ ...curated, verified: false });
    expect(r.ok).toBe(false);
  });

  it("rejects a discovery trek marked verified", () => {
    const r = validateTrek({ ...discovery, verified: true });
    expect(r.ok).toBe(false);
  });
});

describe("validateTrek — image attribution", () => {
  it("rejects an image with a url but no attribution", () => {
    const r = validateTrek({ ...curated, image: { url: "https://x/y.jpg", attribution: "" } });
    expect(r.ok).toBe(false);
  });
});

describe("isTrek", () => {
  it("narrows valid input to true and invalid to false", () => {
    expect(isTrek(curated)).toBe(true);
    expect(isTrek({ id: "x" })).toBe(false);
    expect(isTrek(null)).toBe(false);
  });
});

describe("validateDataset", () => {
  it("accepts an array of valid treks", () => {
    const r = validateDataset([curated, discovery]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.treks).toHaveLength(2);
  });

  it("rejects duplicate ids across the dataset", () => {
    const r = validateDataset([curated, { ...curated }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("skandagiri");
  });

  it("rejects when any single record is invalid", () => {
    const r = validateDataset([curated, { ...discovery, lat: 999 }]);
    expect(r.ok).toBe(false);
  });

  it("rejects a non-array input", () => {
    const r = validateDataset({} as unknown[]);
    expect(r.ok).toBe(false);
  });
});

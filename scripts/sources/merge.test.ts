import { describe, it, expect } from "vitest";
import { mergeTrek } from "./merge";
import type { Trek } from "../../src/lib/trek";

const base: Partial<Trek> = {
  id: "x",
  name: "X",
  lat: 1,
  lng: 2,
  cityId: "bangalore",
  tier: "curated",
  verified: true,
  sources: ["https://manual.example/x"],
};

describe("mergeTrek", () => {
  it("applies positional precedence — the earlier part wins a conflict", () => {
    const merged = mergeTrek([
      { ...base, elevationM: 1350 }, // manual
      { elevationM: 1300, sources: ["https://osm.example/x"] }, // OSM, lower priority
    ]);
    expect(merged.elevationM).toBe(1350);
  });

  it("records every contributing source (deduped)", () => {
    const merged = mergeTrek([
      { ...base, sources: ["https://manual.example/x"] },
      { elevationM: 1300, sources: ["https://osm.example/x", "https://manual.example/x"] },
    ]);
    expect(merged.sources).toEqual(["https://manual.example/x", "https://osm.example/x"]);
  });

  it("uses a lower-priority value when higher-priority parts omit the field (elevation fallback)", () => {
    const merged = mergeTrek([
      { ...base, elevationM: undefined }, // manual lacks elevation
      {}, // OSM lacks elevation
      { elevationM: 1234 }, // Open-Meteo DEM fallback
    ]);
    expect(merged.elevationM).toBe(1234);
  });

  it("ignores undefined/null fields rather than overwriting", () => {
    const merged = mergeTrek([{ ...base, nearestTown: "Town" }, { nearestTown: undefined }]);
    expect(merged.nearestTown).toBe("Town");
  });
});

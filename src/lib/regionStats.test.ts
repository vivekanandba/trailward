import { describe, it, expect } from "vitest";
import { regionStats } from "./regionStats";
import type { Trek } from "./trek";

const t = (over: Partial<Trek>): Trek => ({
  id: over.id ?? "t",
  name: over.name ?? "T",
  lat: 13,
  lng: 77,
  cityId: "bangalore",
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

describe("regionStats", () => {
  it("counts, spreads difficulty (incl. estimated), and finds extremes + top gem", () => {
    const s = regionStats([
      t({ id: "a", difficulty: "Easy", elevationM: 900, reliefM: 100, discoveryScore: 0.4 }),
      t({
        id: "b",
        estimatedDifficulty: "Hard",
        elevationM: 1400,
        reliefM: 500,
        discoveryScore: 0.95,
        name: "Gem",
      }),
      t({
        id: "c",
        estimatedDifficulty: "Easy",
        elevationM: 1100,
        reliefM: 250,
        discoveryScore: 0.6,
      }),
    ]);
    expect(s.count).toBe(3);
    expect(s.spread).toEqual({ Easy: 2, Moderate: 0, Hard: 1 });
    expect(s.highestM).toBe(1400);
    expect(s.maxReliefM).toBe(500);
    expect(s.topGem).toEqual({ name: "Gem", score: 0.95 });
  });

  it("handles an empty set", () => {
    const s = regionStats([]);
    expect(s.count).toBe(0);
    expect(s.highestM).toBeUndefined();
    expect(s.topGem).toBeUndefined();
  });
});

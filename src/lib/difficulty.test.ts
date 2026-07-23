import { describe, it, expect } from "vitest";
import {
  DIFFICULTY_COLORS,
  MAP_DIFFICULTY_COLORS,
  DISCOVERY_COLOR,
  difficultyColor,
  mapDifficultyColor,
  difficultyLabel,
} from "./difficulty";
import type { Difficulty } from "./trek";

const ALL: Difficulty[] = ["Easy", "Moderate", "Hard"];

describe("difficulty colour tokens (single source)", () => {
  it("defines a colour for every difficulty", () => {
    for (const d of ALL) {
      expect(DIFFICULTY_COLORS[d]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("uses a distinct colour per difficulty", () => {
    const set = new Set(ALL.map((d) => DIFFICULTY_COLORS[d]));
    expect(set.size).toBe(ALL.length);
  });

  it("difficultyColor returns the token for a known difficulty", () => {
    expect(difficultyColor("Hard")).toBe(DIFFICULTY_COLORS.Hard);
  });

  it("difficultyColor falls back to the discovery colour when unknown", () => {
    expect(difficultyColor(undefined)).toBe(DISCOVERY_COLOR);
    expect(DISCOVERY_COLOR).not.toBe(DIFFICULTY_COLORS.Easy);
  });

  it("difficultyLabel returns the difficulty or a discovery label", () => {
    expect(difficultyLabel("Easy")).toBe("Easy");
    expect(difficultyLabel(undefined)).toMatch(/unverified|unknown/i);
  });

  it("map colours are defined, distinct, and brighter than the badge colours", () => {
    for (const d of ALL) expect(MAP_DIFFICULTY_COLORS[d]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(ALL.map((d) => MAP_DIFFICULTY_COLORS[d])).size).toBe(ALL.length);
    // Vivid map variants differ from the darker (white-text) badge colours.
    expect(MAP_DIFFICULTY_COLORS.Moderate).not.toBe(DIFFICULTY_COLORS.Moderate);
    expect(MAP_DIFFICULTY_COLORS.Hard).not.toBe(DIFFICULTY_COLORS.Hard);
  });

  it("mapDifficultyColor returns the vivid token or the discovery colour", () => {
    expect(mapDifficultyColor("Moderate")).toBe(MAP_DIFFICULTY_COLORS.Moderate);
    expect(mapDifficultyColor(undefined)).toBe(DISCOVERY_COLOR);
  });
});

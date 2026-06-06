import { describe, it, expect } from "vitest";
import { DIFFICULTY_COLORS, DISCOVERY_COLOR, difficultyColor, difficultyLabel } from "./difficulty";
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
});

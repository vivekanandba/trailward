import { describe, it, expect } from "vitest";
import { settleSnap, translateYFor } from "./sheetMath";

const SNAPS = [0.25, 0.55, 0.92];
const VH = 1000;

describe("sheet snap maths (spec 33)", () => {
  it("translateYFor positions each snap relative to the tallest", () => {
    expect(translateYFor(0.92, 0.92, VH)).toBe(0);
    expect(translateYFor(0.55, 0.92, VH)).toBeCloseTo(370);
    expect(translateYFor(0.25, 0.92, VH)).toBeCloseTo(670);
  });

  it("a slow drag settles on the nearest snap", () => {
    expect(settleSnap(SNAPS, 1, 500, VH, 0, true)).toBe(1); // 0.5 ≈ 0.55
    expect(settleSnap(SNAPS, 1, 800, VH, 0, true)).toBe(2); // 0.8 → 0.92
    expect(settleSnap(SNAPS, 2, 300, VH, 0, true)).toBe(0); // 0.3 → 0.25
  });

  it("a fling advances exactly one snap in the fling direction", () => {
    expect(settleSnap(SNAPS, 0, 300, VH, 1.2, true)).toBe(1); // up from peek
    expect(settleSnap(SNAPS, 2, 800, VH, -1.2, true)).toBe(1); // down from full
    expect(settleSnap(SNAPS, 2, 900, VH, 3, true)).toBe(2); // can't fling past top
  });

  it("releasing clearly below the lowest snap closes — only when closable", () => {
    expect(settleSnap(SNAPS, 0, 100, VH, 0, true)).toBe("close"); // 0.1 < 0.25*0.6
    expect(settleSnap(SNAPS, 0, 100, VH, 0, false)).toBe(0); // results sheet never closes
    expect(settleSnap(SNAPS, 0, 200, VH, -1.5, true)).toBe("close"); // down-fling at peek
    expect(settleSnap(SNAPS, 0, 200, VH, -1.5, false)).toBe(0);
  });
});

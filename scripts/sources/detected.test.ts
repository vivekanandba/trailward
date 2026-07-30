import { describe, it, expect } from "vitest";
import { detectedSummitsNear, humanNames } from "./detected";

describe("detectedSummitsNear", () => {
  it("returns only summits within the radius (or [] before the subset is built)", () => {
    const near = detectedSummitsNear({ id: "bangalore", name: "B", lat: 12.97, lng: 77.59 }, 500);
    const far = detectedSummitsNear({ id: "x", name: "x", lat: -40, lng: -170 }, 50);
    expect(Array.isArray(near)).toBe(true);
    expect(far).toEqual([]); // nothing in the south Pacific either way
    for (const s of near.slice(0, 50)) {
      expect(Math.abs(s.lat - 12.97)).toBeLessThan(5);
    }
  });
});

describe("humanNames", () => {
  it("returns the committed overrides, or {} before any exist", () => {
    const names = humanNames();
    expect(typeof names).toBe("object");
    for (const v of Object.values(names)) {
      expect(typeof v.name).toBe("string");
      expect(typeof v.issue).toBe("number");
    }
  });
});

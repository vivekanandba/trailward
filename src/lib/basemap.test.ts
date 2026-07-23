import { describe, it, expect, beforeEach } from "vitest";
import { loadBasemap, saveBasemap } from "./basemap";

describe("basemap persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 'terrain' when nothing is stored (trekking app)", () => {
    expect(loadBasemap()).toBe("terrain");
  });

  it("round-trips a saved choice", () => {
    saveBasemap("map");
    expect(loadBasemap()).toBe("map");
  });

  it("falls back to 'terrain' on an invalid stored value", () => {
    localStorage.setItem("trailward:basemap", "satellite");
    expect(loadBasemap()).toBe("terrain");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { loadBasemap, saveBasemap } from "./basemap";

describe("basemap persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 'map' when nothing is stored", () => {
    expect(loadBasemap()).toBe("map");
  });

  it("round-trips a saved choice", () => {
    saveBasemap("terrain");
    expect(loadBasemap()).toBe("terrain");
  });

  it("falls back to 'map' on an invalid stored value", () => {
    localStorage.setItem("trailward:basemap", "satellite");
    expect(loadBasemap()).toBe("map");
  });
});

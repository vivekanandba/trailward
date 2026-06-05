import { describe, it, expect, beforeEach } from "vitest";
import { ORIGIN_STORAGE_KEY, loadOrigin, saveOrigin } from "./origin";
import { DEFAULT_ORIGIN, type Origin } from "./trek";

beforeEach(() => {
  localStorage.clear();
});

describe("loadOrigin", () => {
  it("returns DEFAULT_ORIGIN when storage is empty", () => {
    expect(loadOrigin()).toEqual(DEFAULT_ORIGIN);
  });

  it("returns DEFAULT_ORIGIN when stored value is corrupt JSON", () => {
    localStorage.setItem(ORIGIN_STORAGE_KEY, "{not json");
    expect(loadOrigin()).toEqual(DEFAULT_ORIGIN);
  });

  it("returns DEFAULT_ORIGIN when stored value fails validation", () => {
    localStorage.setItem(ORIGIN_STORAGE_KEY, JSON.stringify({ id: "x", lat: 999 }));
    expect(loadOrigin()).toEqual(DEFAULT_ORIGIN);
  });

  it("round-trips a saved origin", () => {
    const pune: Origin = { id: "pune", name: "Pune", lat: 18.5204, lng: 73.8567 };
    saveOrigin(pune);
    expect(loadOrigin()).toEqual(pune);
  });
});

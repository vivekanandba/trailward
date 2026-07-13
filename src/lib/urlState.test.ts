import { describe, it, expect } from "vitest";
import { encodeState, decodeState } from "./urlState";
import { DEFAULT_FILTERS, type FilterState } from "./filters";
import type { Origin } from "./trek";

const origin: Origin = { id: "bangalore", name: "Bengaluru", lat: 12.9716, lng: 77.5946 };

function roundTrip(origin: Origin, filters: FilterState, selectedId?: string) {
  return decodeState(new URLSearchParams(encodeState(origin, filters, selectedId)));
}

describe("urlState", () => {
  it("round-trips the origin (incl. id, which selects curated vs discovery)", () => {
    const s = roundTrip(origin, DEFAULT_FILTERS);
    expect(s.origin).toEqual(origin);
  });

  it("omits default filters from the query string", () => {
    const qs = encodeState(origin, DEFAULT_FILTERS);
    expect(qs).not.toMatch(/(^|&)(r|d|t|e|tl|du|p|n|q|sel)=/);
  });

  it("round-trips active filters and selection", () => {
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      radiusKm: 60,
      difficulties: ["Easy", "Hard"],
      types: ["Fort"],
      elevation: [500, 1500],
      permitRequired: false,
      nightOnly: true,
      query: "hill",
    };
    const s = roundTrip(origin, filters, "skandagiri");
    expect(s.filters).toEqual(filters);
    expect(s.selectedId).toBe("skandagiri");
  });

  it("falls back to defaults for missing/invalid params", () => {
    const s = decodeState(new URLSearchParams("r=abc&e=bad&oid=x"));
    expect(s.filters.radiusKm).toBe(DEFAULT_FILTERS.radiusKm);
    expect(s.filters.elevation).toBeUndefined();
    expect(s.origin).toBeUndefined(); // incomplete origin (no lat/lng/name) → dropped
    expect(s.selectedId).toBeUndefined();
  });

  it("ignores unknown difficulty/type tokens", () => {
    const s = decodeState(new URLSearchParams("d=Easy,Bogus&t=Fort,Nope"));
    expect(s.filters.difficulties).toEqual(["Easy"]);
    expect(s.filters.types).toEqual(["Fort"]);
  });
});

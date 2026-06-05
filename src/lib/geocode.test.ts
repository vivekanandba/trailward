import { describe, it, expect, vi, afterEach } from "vitest";
import { geocode, parseGeocode } from "./geocode";

// A trimmed Nominatim /search response (lat/lon are strings in the real API).
const fixture = [
  {
    lat: "18.5204303",
    lon: "73.8567437",
    display_name: "Pune, Maharashtra, India",
    name: "Pune",
  },
  {
    lat: "not-a-number",
    lon: "73.0",
    display_name: "Broken row",
    name: "Broken",
  },
  {
    lat: "12.9716",
    lon: "77.5946",
    display_name: "Bengaluru, Karnataka, India",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseGeocode (pure)", () => {
  it("maps valid rows and coerces string coords to numbers", () => {
    const out = parseGeocode(fixture);
    expect(out[0]).toEqual({
      name: "Pune",
      lat: 18.5204303,
      lng: 73.8567437,
      displayName: "Pune, Maharashtra, India",
    });
  });

  it("drops rows with non-numeric coordinates", () => {
    expect(parseGeocode(fixture).some((r) => r.displayName === "Broken row")).toBe(false);
  });

  it("falls back to the first display_name segment when name is absent", () => {
    const out = parseGeocode(fixture);
    expect(out.find((r) => r.lat === 12.9716)?.name).toBe("Bengaluru");
  });

  it("returns [] for non-array input", () => {
    expect(parseGeocode({})).toEqual([]);
  });
});

describe("geocode (fetch wrapper)", () => {
  it("does not fetch for an empty/whitespace query", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await geocode("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches Nominatim and returns parsed results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await geocode("Pune");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("nominatim.openstreetmap.org");
    expect(out[0].name).toBe("Pune");
  });

  it("returns [] on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await geocode("Pune")).toEqual([]);
  });
});

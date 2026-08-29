import { describe, it, expect, vi, afterEach } from "vitest";
import { locateMe, geolocationGranted } from "./locate";

afterEach(() => vi.unstubAllGlobals());

describe("locateMe (spec 34)", () => {
  it("resolves an Origin from the device position", async () => {
    const geo = {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 12.34567, longitude: 76.54321 } } as GeolocationPosition),
    } as unknown as Geolocation;
    await expect(locateMe(geo)).resolves.toEqual({
      id: "geo:12.3457,76.5432",
      name: "My location",
      lat: 12.34567,
      lng: 76.54321,
    });
  });

  it("rejects with a human message on failure or missing support", async () => {
    const geo = {
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({} as GeolocationPositionError),
    } as unknown as Geolocation;
    await expect(locateMe(geo)).rejects.toThrow(/couldn't get/i);
    await expect(locateMe(undefined)).rejects.toThrow(/isn't available/i);
  });
});

describe("geolocationGranted (spec 34 — the silent path must never prompt)", () => {
  it("is true only for state 'granted'", async () => {
    for (const [state, want] of [
      ["granted", true],
      ["prompt", false],
      ["denied", false],
    ] as const) {
      vi.stubGlobal("navigator", {
        permissions: { query: async () => ({ state }) },
      });
      expect(await geolocationGranted()).toBe(want);
    }
  });

  it("is false when the Permissions API is missing or throws", async () => {
    vi.stubGlobal("navigator", {});
    expect(await geolocationGranted()).toBe(false);
    vi.stubGlobal("navigator", {
      permissions: {
        query: async () => {
          throw new Error("nope");
        },
      },
    });
    expect(await geolocationGranted()).toBe(false);
  });
});

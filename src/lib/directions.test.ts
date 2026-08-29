import { describe, it, expect } from "vitest";
import { googleMapsDirectionsUrl } from "./directions";
import type { Trek } from "./trek";

const trek: Trek = {
  id: "skandagiri",
  name: "Skandagiri",
  lat: 13.5021,
  lng: 77.6911,
  cityId: "bangalore",
  tier: "curated",
  sources: ["https://x"],
  verified: true,
};

describe("googleMapsDirectionsUrl", () => {
  it("routes to the trek from the device's LIVE position — origin omitted (spec 34)", () => {
    const url = googleMapsDirectionsUrl(trek);
    const parsed = new URL(url);
    expect(parsed.hostname).toContain("google.com");
    // No origin param: Maps starts from wherever the user actually is, never
    // from a stale search origin.
    expect(parsed.searchParams.get("origin")).toBeNull();
    expect(parsed.searchParams.get("destination")).toBe("13.5021,77.6911");
  });
});

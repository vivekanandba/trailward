import { describe, it, expect } from "vitest";
import { googleMapsDirectionsUrl } from "./directions";
import { DEFAULT_ORIGIN, type Trek } from "./trek";

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
  it("builds a maps dir URL with origin and destination coords", () => {
    const url = googleMapsDirectionsUrl(DEFAULT_ORIGIN, trek);
    const parsed = new URL(url);
    expect(parsed.hostname).toContain("google.com");
    expect(parsed.searchParams.get("origin")).toBe("12.9716,77.5946");
    expect(parsed.searchParams.get("destination")).toBe("13.5021,77.6911");
  });
});

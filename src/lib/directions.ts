// Google Maps directions link to a trek (spec 06/34). The origin is
// deliberately OMITTED: Maps then routes from the device's live position —
// you navigate from where you ARE, not from the possibly-stale search origin
// (browsing Himachal from a Bengaluru search must not route 2,400 km).
import type { Trek } from "./trek";

export function googleMapsDirectionsUrl(trek: Trek): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${trek.lat},${trek.lng}`,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

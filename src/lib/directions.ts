// Google Maps directions link from the active origin to a trek (spec 06).
import type { Origin, Trek } from "./trek";

export function googleMapsDirectionsUrl(origin: Origin, trek: Trek): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${trek.lat},${trek.lng}`,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

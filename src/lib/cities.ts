// Preset origin chips for quick jumps (spec 03). Bengaluru is curated (its id
// matches the seeded cityId, so it shows hand-verified treks); the rest use the
// geo: id scheme, so they fall through to live OpenStreetMap discovery — no
// fabricated trek data, just real peaks with the "unverified" badge.
import { DEFAULT_ORIGIN, type Origin } from "./trek";

function geo(name: string, lat: number, lng: number): Origin {
  return { id: `geo:${lat.toFixed(4)},${lng.toFixed(4)}`, name, lat, lng };
}

export const PRESET_ORIGINS: Origin[] = [
  DEFAULT_ORIGIN, // Bengaluru (curated)
  geo("Pune", 18.5204, 73.8567),
  geo("Mumbai", 19.076, 72.8777),
  geo("Hyderabad", 17.385, 78.4867),
  geo("Chikmagalur", 13.3161, 75.772),
];

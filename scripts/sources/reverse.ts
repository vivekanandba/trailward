/**
 * Nominatim reverse geocoding (spec 11 enrichment) — the nearest town/village
 * to a discovery peak, for a sense of place. Free, no key; goes through the
 * allowlisted host with the TrailwardBot UA + 1 req/s throttle (Nominatim
 * usage policy). parseReverseTown is pure.
 */
import { fetchJson } from "./http";

interface ReverseResponse {
  address?: Record<string, unknown>;
}

// Preference order: the most "place"-like label first.
const TOWN_KEYS = ["town", "village", "city", "hamlet", "suburb", "municipality", "county"];

/** Pure parser: Nominatim reverse JSON → a town/village name, or undefined. */
export function parseReverseTown(json: unknown): string | undefined {
  const address = (json as ReverseResponse)?.address;
  if (!address) return undefined;
  for (const key of TOWN_KEYS) {
    const v = address[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Nearest town/village to a point, or undefined on any failure. */
export async function fetchNearestTown(lat: number, lng: number): Promise<string | undefined> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}` +
    `&format=jsonv2&zoom=13&addressdetails=1`;
  try {
    return parseReverseTown(await fetchJson(url));
  } catch {
    return undefined;
  }
}

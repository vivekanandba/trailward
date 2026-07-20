/**
 * Wikipedia GeoSearch (spec 11) — "is this place documented?" obscurity signal.
 * No API key; goes through the allowlisted `en.wikipedia.org` host with the
 * TrailwardBot UA + throttle. parseGeoSearchCount is pure (testable on a
 * recorded fixture); fetchGeoSearchCount is the build-time network wrapper.
 */
import { fetchJson } from "./http";

interface GeoSearchResponse {
  query?: { geosearch?: unknown };
}

/** Pure parser: MediaWiki geosearch JSON → number of nearby articles. */
export function parseGeoSearchCount(json: unknown): number {
  const arr = (json as GeoSearchResponse)?.query?.geosearch;
  return Array.isArray(arr) ? arr.length : 0;
}

/**
 * Count Wikipedia articles within `radiusM` (10–10000) of a point. Returns the
 * count, or -1 when the lookup fails so the scorer can treat it as "unknown"
 * (neutral) rather than "undocumented".
 */
export async function fetchGeoSearchCount(
  lat: number,
  lng: number,
  radiusM = 1000,
  limit = 20,
): Promise<number> {
  const coord = encodeURIComponent(`${lat}|${lng}`);
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch` +
    `&gscoord=${coord}&gsradius=${radiusM}&gslimit=${limit}&format=json`;
  try {
    return parseGeoSearchCount(await fetchJson(url));
  } catch {
    return -1;
  }
}

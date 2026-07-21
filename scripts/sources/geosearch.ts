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

export interface GeoSearchHit {
  title: string;
  dist: number; // metres from the query point
}

/** Pure parser: MediaWiki geosearch JSON → number of nearby articles. */
export function parseGeoSearchCount(json: unknown): number {
  const arr = (json as GeoSearchResponse)?.query?.geosearch;
  return Array.isArray(arr) ? arr.length : 0;
}

/** Pure parser: MediaWiki geosearch JSON → hits (title + distance), nearest first. */
export function parseGeoSearchHits(json: unknown): GeoSearchHit[] {
  const arr = (json as GeoSearchResponse)?.query?.geosearch;
  if (!Array.isArray(arr)) return [];
  const hits: GeoSearchHit[] = [];
  for (const row of arr as { title?: unknown; dist?: unknown }[]) {
    if (typeof row?.title === "string") {
      hits.push({ title: row.title, dist: Number(row.dist) || 0 });
    }
  }
  return hits.sort((a, b) => a.dist - b.dist);
}

/**
 * Title of the closest Wikipedia article within `radiusM` of a point, or
 * undefined. Used to attach a short description to a discovery peak only when an
 * article genuinely sits on it (not a far-away namesake).
 */
export async function fetchNearestArticle(
  lat: number,
  lng: number,
  radiusM = 800,
): Promise<string | undefined> {
  const coord = encodeURIComponent(`${lat}|${lng}`);
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch` +
    `&gscoord=${coord}&gsradius=${radiusM}&gslimit=5&format=json`;
  try {
    const hits = parseGeoSearchHits(await fetchJson(url));
    return hits[0]?.title;
  } catch {
    return undefined;
  }
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

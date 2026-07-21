/**
 * Overpass (OSM) peaks for the build-time pipeline (spec 02). The PARSER is the
 * same pure `parsePeaks` the browser uses for live discovery (spec 03) — one
 * parser, two callers. This module only adds the build-time fetch wrapper.
 */
import type { Origin } from "../../src/lib/trek";
import { parsePeaks, type ParsedPeak } from "../../src/lib/overpass";
import type { LatLng } from "../../src/lib/terrain";
import { fetchText } from "./http";

export { parsePeaks };

// Primary endpoint plus a mirror: the public Overpass instances 429/504 under
// load, so we fail over rather than dropping a whole region.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function fetchOverpass(query: string): Promise<unknown> {
  let lastErr: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const text = await fetchText(url, {
        method: "POST",
        body: query,
        headers: { "content-type": "text/plain" },
        // Overpass can be slow on dense / large-radius regions (e.g. Bengaluru at
        // 500 km, peaks+hills); give it well over the query's server-side timeout.
        timeoutMs: 240_000,
      });
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("overpass request failed");
}

/**
 * Fetch summits within radiusKm of an origin as parsed peaks. Includes both
 * `natural=peak` AND `natural=hill` — many South-Indian hills (bettas, gundus,
 * kondas) are tagged `hill`, so peaks-only misses them (spec 11). Server-side
 * timeout scales with radius so a large sweep doesn't return empty.
 */
export async function fetchPeaks(origin: Origin, radiusKm: number): Promise<ParsedPeak[]> {
  const serverTimeout = radiusKm >= 300 ? 180 : 60;
  const around = `around:${radiusKm * 1000},${origin.lat},${origin.lng}`;
  const query = `[out:json][timeout:${serverTimeout}];(node(${around})[natural=peak];node(${around})[natural=hill];);out;`;
  return parsePeaks(await fetchOverpass(query));
}

/** Pure parser: Overpass JSON → the lat/lng of every element (node or centroid). */
export function parseLatLngs(json: unknown): LatLng[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const points: LatLng[] = [];
  for (const el of elements as {
    lat?: unknown;
    lon?: unknown;
    center?: { lat?: unknown; lon?: unknown };
  }[]) {
    const lat = Number(el?.lat ?? el?.center?.lat);
    const lng = Number(el?.lon ?? el?.center?.lon);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) points.push({ lat, lng });
  }
  return points;
}

/**
 * Tourism POIs (viewpoints, attractions, lodging, …) within radiusKm — an
 * amenity-density proxy for how developed/known an area is (spec 11 obscurity).
 */
export async function fetchTourismPoints(origin: Origin, radiusKm: number): Promise<LatLng[]> {
  // A high-signal subset of tourism tags (lodging + attractions), so the query
  // stays light enough not to trip Overpass rate limits over a 150 km radius.
  const tags = "hotel|guest_house|hostel|resort|attraction|viewpoint|museum|camp_site|theme_park";
  const query = `[out:json][timeout:60];node(around:${radiusKm * 1000},${origin.lat},${origin.lng})[tourism~"^(${tags})$"];out;`;
  return parseLatLngs(await fetchOverpass(query));
}

/**
 * Overpass (OSM) peaks for the build-time pipeline (spec 02). The PARSER is the
 * same pure `parsePeaks` the browser uses for live discovery (spec 03) — one
 * parser, two callers. This module only adds the build-time fetch wrapper.
 */
import type { Origin, Trek } from "../../src/lib/trek";
import { parsePeaks } from "../../src/lib/overpass";
import { fetchText } from "./http";

export { parsePeaks };

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Fetch peaks within radiusKm of an origin as partial treks. */
export async function fetchPeaks(origin: Origin, radiusKm: number): Promise<Partial<Trek>[]> {
  const query = `[out:json][timeout:25];node(around:${radiusKm * 1000},${origin.lat},${origin.lng})[natural=peak];out;`;
  const text = await fetchText(OVERPASS_URL, {
    method: "POST",
    body: query,
    headers: { "content-type": "text/plain" },
  });
  return parsePeaks(JSON.parse(text));
}

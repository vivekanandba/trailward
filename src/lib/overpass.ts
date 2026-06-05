// Overpass (OpenStreetMap) peaks. parsePeaks is a pure parser shared by the
// build-time pipeline (spec 02) and runtime discovery (spec 03) so there is one
// parser. discoverPeaks runs in the browser for origins we haven't curated.
import type { Origin, Trek } from "./trek";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Cap dense regions; we surface truncation rather than silently dropping peaks.
export const MAX_DISCOVERY = 100;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: unknown;
  lon?: unknown;
  tags?: Record<string, unknown>;
}

/** Pure parser: Overpass JSON → partial treks (id, name, coords, elevation). */
export function parsePeaks(json: unknown): Partial<Trek>[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];

  const peaks: Partial<Trek>[] = [];
  for (const el of elements as OverpassElement[]) {
    const lat = Number(el?.lat);
    const lng = Number(el?.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

    const tags = el?.tags ?? {};
    const name = typeof tags.name === "string" && tags.name ? tags.name : "Unnamed Peak";
    const ele = Number(tags.ele);
    const elevationM = !Number.isNaN(ele) && ele >= 0 && ele <= 9000 ? ele : undefined;

    peaks.push({ id: `osm-${el.id}`, name, lat, lng, elevationM });
  }
  return peaks;
}

/**
 * Discover peaks within radiusKm of the origin as discovery-tier treks. Returns
 * [] on any failure (caller keeps prior state). Caps at MAX_DISCOVERY (highest
 * elevation first) and warns when the list is truncated.
 */
export async function discoverPeaks(origin: Origin, radiusKm: number): Promise<Trek[]> {
  const query = `[out:json][timeout:25];node(around:${radiusKm * 1000},${origin.lat},${origin.lng})[natural=peak];out;`;
  let parsed: Partial<Trek>[];
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
    });
    if (!res.ok) return [];
    parsed = parsePeaks(await res.json());
  } catch {
    return [];
  }

  parsed.sort((a, b) => (b.elevationM ?? 0) - (a.elevationM ?? 0));
  if (parsed.length > MAX_DISCOVERY) {
    console.warn(
      `[discoverPeaks] ${parsed.length} peaks within ${radiusKm} km of ${origin.name}; showing top ${MAX_DISCOVERY} by elevation.`,
    );
    parsed = parsed.slice(0, MAX_DISCOVERY);
  }

  return parsed.map((p) => ({
    ...p,
    id: p.id as string,
    name: p.name as string,
    lat: p.lat as number,
    lng: p.lng as number,
    cityId: origin.id,
    tier: "discovery",
    sources: [],
    verified: false,
  }));
}

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
  center?: { lat?: unknown; lon?: unknown };
  tags?: Record<string, unknown>;
}

/** Notability + opportunistic terrain signals read straight from OSM tags. */
export interface PeakNotability {
  hasWikipediaTag: boolean;
  hasWikidataTag: boolean;
  nameEn?: string;
  osmProminenceM?: number; // from tags.prominence when present (rare but authoritative)
}

/**
 * Parsed peak: the trek-shaped core (id, name, coords, elevation) plus OSM
 * notability tags the precompute pipeline (spec 11) needs. `notability` is kept
 * separate so runtime discovery can drop it and emit clean Trek objects.
 */
export interface ParsedPeak {
  id: string;
  name: string;
  lat: number;
  lng: number;
  elevationM?: number;
  notability: PeakNotability;
  // Carry-through for manually-added peaks (spec 12); OSM parsing leaves unset.
  sourceUrl?: string; // overrides the default OSM-node source link
  note?: string; // seeds `highlights`
}

/** Pure parser: Overpass JSON → parsed peaks (coords, elevation, notability). */
export function parsePeaks(json: unknown): ParsedPeak[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];

  const peaks: ParsedPeak[] = [];
  for (const el of elements as OverpassElement[]) {
    // Ways/relations (e.g. cliffs) carry a computed centroid under `center`.
    const lat = Number(el?.lat ?? el?.center?.lat);
    const lng = Number(el?.lon ?? el?.center?.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

    const tags = el?.tags ?? {};
    const name = typeof tags.name === "string" && tags.name ? tags.name : "Unnamed Peak";
    const ele = Number(tags.ele);
    const elevationM = !Number.isNaN(ele) && ele >= 0 && ele <= 9000 ? ele : undefined;
    const prom = Number(tags.prominence);

    peaks.push({
      id: `osm-${el.id}`,
      name,
      lat,
      lng,
      elevationM,
      notability: {
        hasWikipediaTag: typeof tags.wikipedia === "string" && tags.wikipedia.length > 0,
        hasWikidataTag: typeof tags.wikidata === "string" && tags.wikidata.length > 0,
        nameEn: typeof tags["name:en"] === "string" ? (tags["name:en"] as string) : undefined,
        osmProminenceM: !Number.isNaN(prom) && prom >= 0 && prom <= 9000 ? prom : undefined,
      },
    });
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
  let parsed: ParsedPeak[];
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

  // Build the Trek explicitly (dropping the pipeline-only `notability` blob) so
  // the live discovery record stays minimal, exactly as before.
  return parsed.map((p) => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    elevationM: p.elevationM,
    cityId: origin.id,
    tier: "discovery" as const,
    sources: [],
    verified: false,
  }));
}

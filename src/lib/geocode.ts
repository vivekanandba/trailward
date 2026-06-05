// Geocoding via Nominatim (spec 03). Free, no key. Honors usage policy with a
// descriptive User-Agent and limited result count; debounce/throttle is the
// caller's job (the origin picker component).
export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
  displayName: string;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Pure parser: Nominatim JSON → GeocodeResult[], dropping malformed rows. */
export function parseGeocode(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) return [];
  const results: GeocodeResult[] = [];
  for (const row of json) {
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    const displayName = typeof row?.display_name === "string" ? row.display_name : "";
    if (Number.isNaN(lat) || Number.isNaN(lng) || !displayName) continue;
    const name = typeof row?.name === "string" && row.name ? row.name : displayName.split(",")[0];
    results.push({ name, lat, lng, displayName });
  }
  return results;
}

/** Search a place by free text. Returns [] for empty input or any failure. */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];

  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=jsonv2&limit=5`;
  try {
    const res = await fetch(url, {
      headers: { "Accept-Language": "en", "User-Agent": "Trailward/0.1 (trek map)" },
    });
    if (!res.ok) return [];
    return parseGeocode(await res.json());
  } catch {
    return [];
  }
}

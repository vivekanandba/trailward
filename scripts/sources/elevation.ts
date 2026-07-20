/**
 * Open-Meteo elevation (DEM) — the fallback when OSM has no `ele` tag (spec 02).
 * parseElevations is pure (testable against a recorded fixture); fetchElevations
 * batches a set of points into one request.
 */
import { fetchJson } from "./http";

interface ElevationResponse {
  elevation?: unknown;
}

/** Pure parser: Open-Meteo elevation JSON → metres[] (skips non-finite). */
export function parseElevations(json: unknown): (number | undefined)[] {
  const arr = (json as ElevationResponse)?.elevation;
  if (!Array.isArray(arr)) return [];
  return arr.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 9000 ? n : undefined;
  });
}

export interface LatLng {
  lat: number;
  lng: number;
}

// Open-Meteo accepts up to 100 coordinates per elevation request.
const MAX_POINTS_PER_REQUEST = 100;

/** Split an array into fixed-size chunks (last chunk may be shorter). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Fetch elevation (m) for each point; index-aligned with the input. Requests are
 * batched at MAX_POINTS_PER_REQUEST and re-joined in order, so callers can pass
 * an arbitrarily long list (e.g. a rosette grid over many candidates).
 */
export async function fetchElevations(points: LatLng[]): Promise<(number | undefined)[]> {
  if (points.length === 0) return [];
  const results: (number | undefined)[] = [];
  for (const batch of chunk(points, MAX_POINTS_PER_REQUEST)) {
    const lats = batch.map((p) => p.lat).join(",");
    const lngs = batch.map((p) => p.lng).join(",");
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    results.push(...parseElevations(await fetchJson(url)));
  }
  return results;
}

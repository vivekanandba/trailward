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

/** Fetch elevation (m) for each point; index-aligned with the input. */
export async function fetchElevations(points: LatLng[]): Promise<(number | undefined)[]> {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.lat).join(",");
  const lngs = points.map((p) => p.lng).join(",");
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
  return parseElevations(await fetchJson(url));
}

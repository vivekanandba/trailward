/**
 * Elevation (DEM) sampling (spec 02/11). Primary source is Open-Meteo
 * (Copernicus 90 m); OpenTopoData (ASTER 30 m) is a failover for when Open-Meteo
 * throttles under heavy sampling (its quota is weighted by coordinate count).
 * The parsers are pure (testable against recorded fixtures); fetchElevations
 * batches, and falls back per batch so a throttle never aborts a whole region.
 */
import { fetchJson } from "./http";

const clampM = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 9000 ? n : undefined;
};

interface ElevationResponse {
  elevation?: unknown;
}

/** Pure parser: Open-Meteo elevation JSON → metres[] (skips non-finite). */
export function parseElevations(json: unknown): (number | undefined)[] {
  const arr = (json as ElevationResponse)?.elevation;
  if (!Array.isArray(arr)) return [];
  return arr.map(clampM);
}

interface TopoDataResponse {
  results?: { elevation?: unknown }[];
}

/** Pure parser: OpenTopoData JSON → metres[] (index-aligned with results). */
export function parseTopoData(json: unknown): (number | undefined)[] {
  const arr = (json as TopoDataResponse)?.results;
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => clampM(r?.elevation));
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

async function openMeteoBatch(batch: LatLng[]): Promise<(number | undefined)[]> {
  const lats = batch.map((p) => p.lat).join(",");
  const lngs = batch.map((p) => p.lng).join(",");
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
  return parseElevations(await fetchJson(url));
}

async function topoDataBatch(batch: LatLng[]): Promise<(number | undefined)[]> {
  const locations = batch.map((p) => `${p.lat},${p.lng}`).join("|");
  const url = `https://api.opentopodata.org/v1/aster30m?locations=${locations}`;
  return parseTopoData(await fetchJson(url));
}

/**
 * Fetch elevation (m) for each point; index-aligned with the input. Requests are
 * batched at MAX_POINTS_PER_REQUEST and re-joined in order, so callers can pass
 * an arbitrarily long list (e.g. a rosette grid over many candidates). Each batch
 * tries Open-Meteo first and falls back to OpenTopoData on any failure (e.g. a
 * 429), so a throttle degrades resolution rather than aborting the region. A
 * batch that yields the wrong count from a source is retried on the other.
 */
export async function fetchElevations(points: LatLng[]): Promise<(number | undefined)[]> {
  if (points.length === 0) return [];
  const results: (number | undefined)[] = [];
  for (const batch of chunk(points, MAX_POINTS_PER_REQUEST)) {
    let out: (number | undefined)[];
    try {
      out = await openMeteoBatch(batch);
      if (out.length !== batch.length) out = await topoDataBatch(batch);
    } catch {
      out = await topoDataBatch(batch);
    }
    results.push(...out);
  }
  return results;
}

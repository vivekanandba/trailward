// Terrain metrics from sampled DEM points (spec 11). Pure and framework-free so
// it runs identically in the build-time precompute (scripts/*) and in tests.
// The DEM is Copernicus GLO-90 (~90 m) via Open-Meteo; formulas are the standard
// GIS relief/slope plus Riley's Terrain Ruggedness Index, with a windowed
// prominence proxy standing in for (unavailable) true watershed prominence.
import type { Difficulty } from "./trek";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TerrainMetrics {
  reliefM: number; // max − min over the sampled window
  prominenceProxyM: number; // summit − lowest ring point (clamped ≥ 0)
  meanSlopeDeg: number;
  maxSlopeDeg: number;
  tri: number; // Riley Terrain Ruggedness Index
  confidence: number; // [0,1]; low for sub-noise-floor relief or sparse samples
}

const METERS_PER_DEG_LAT = 111320;
const RING_BEARINGS_DEG = [0, 45, 90, 135, 180, 225, 270, 315];
const MIN_RING_SAMPLES = 3;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * The 8 compass points a fixed ground distance from `center`. Longitude is
 * scaled by 1/cos(lat) so the ring stays circular away from the equator; every
 * returned point is `radiusM` metres from the center regardless of bearing.
 */
export function rosetteRing(center: LatLng, radiusM: number): LatLng[] {
  const dLat = radiusM / METERS_PER_DEG_LAT;
  const dLng = radiusM / (METERS_PER_DEG_LAT * Math.cos(toRad(center.lat)));
  return RING_BEARINGS_DEG.map((bearing) => {
    const theta = toRad(bearing);
    return {
      lat: center.lat + dLat * Math.cos(theta),
      lng: center.lng + dLng * Math.sin(theta),
    };
  });
}

/**
 * Derive terrain metrics from a summit elevation and its ring of neighbour
 * elevations (undefined = failed DEM sample, ignored). Returns zeroed metrics
 * with confidence 0 when the summit is missing or fewer than MIN_RING_SAMPLES
 * ring points are valid — the caller ranks such candidates low rather than
 * trusting noise.
 */
export function computeTerrain(
  centerElev: number | undefined,
  ringElevs: (number | undefined)[],
  radiusM: number,
): TerrainMetrics {
  const zero: TerrainMetrics = {
    reliefM: 0,
    prominenceProxyM: 0,
    meanSlopeDeg: 0,
    maxSlopeDeg: 0,
    tri: 0,
    confidence: 0,
  };

  const ring = ringElevs.filter((e): e is number => typeof e === "number" && Number.isFinite(e));
  if (typeof centerElev !== "number" || !Number.isFinite(centerElev)) return zero;
  if (ring.length < MIN_RING_SAMPLES) return zero;

  const all = [centerElev, ...ring];
  const reliefM = Math.max(...all) - Math.min(...all);
  const prominenceProxyM = Math.max(0, centerElev - Math.min(...ring));

  const slopesDeg = ring.map((e) => toDeg(Math.atan(Math.abs(centerElev - e) / radiusM)));
  const meanSlopeDeg = slopesDeg.reduce((s, d) => s + d, 0) / slopesDeg.length;
  const maxSlopeDeg = Math.max(...slopesDeg);

  const tri = Math.sqrt(ring.reduce((s, e) => s + (e - centerElev) ** 2, 0));

  // Near 0 below ~20 m relief (the 90 m-DEM noise floor), reaching 1 by ~100 m.
  const confidence = clamp01((reliefM - 20) / 80);

  return { reliefM, prominenceProxyM, meanSlopeDeg, maxSlopeDeg, tri, confidence };
}

/**
 * A coarse difficulty estimate from terrain alone — deliberately conservative
 * and stored as `estimatedDifficulty` (never the curated `difficulty`), since
 * relief + slope can't capture exposure, scrambling, or trail condition.
 */
export function estimateDifficulty(
  m: Pick<TerrainMetrics, "reliefM" | "meanSlopeDeg">,
): Difficulty {
  if (m.reliefM >= 700 || m.meanSlopeDeg >= 20) return "Hard";
  if (m.reliefM >= 250 || m.meanSlopeDeg >= 12) return "Moderate";
  return "Easy";
}

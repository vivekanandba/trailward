/**
 * Nearest OSM walking path to a summit (spec 14). The pure helpers (parse, pick,
 * simplify, length) are unit-tested; fetchTrail wires Overpass geometry + a DEM
 * elevation sampler and is best-effort (a peak with no nearby path → no trail).
 */
import type { Trek } from "../../src/lib/trek";
import { distanceFrom } from "../../src/lib/distance";
import { fetchOverpass } from "./overpass";
import type { LatLng } from "./elevation";

type Pt = [number, number]; // [lat, lng]

const MAX_TRAIL_POINTS = 30;
const NEAR_SUMMIT_M = 250;

interface GeomEl {
  geometry?: { lat?: unknown; lon?: unknown }[];
}

export type Poi = NonNullable<Trek["pois"]>[number];

/** Pure: Overpass nodes → the nearest parking / water / viewpoint to the summit. */
export function parsePois(json: unknown, summit: { lat: number; lng: number }): Poi[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const nearest = new Map<Poi["kind"], Poi>();
  for (const el of elements as {
    lat?: unknown;
    lon?: unknown;
    tags?: Record<string, unknown>;
  }[]) {
    const lat = Number(el?.lat);
    const lng = Number(el?.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue; // nodes only (ways have no lat)
    const tags = el?.tags ?? {};
    let kind: Poi["kind"] | undefined;
    if (tags.amenity === "parking") kind = "parking";
    else if (tags.amenity === "drinking_water" || tags.natural === "spring") kind = "water";
    else if (tags.tourism === "viewpoint") kind = "viewpoint";
    if (!kind) continue;
    const distM = Math.round(distM_(lat, lng, summit));
    const prev = nearest.get(kind);
    if (!prev || distM < prev.distM) nearest.set(kind, { kind, lat, lng, distM });
  }
  return [...nearest.values()].sort((a, b) => a.distM - b.distM);
}

const distM_ = (lat: number, lng: number, s: { lat: number; lng: number }): number =>
  distanceFrom({ id: "", name: "", lat, lng }, s) * 1000;

/** Pure: Overpass `out geom` ways → polylines of [lat, lng]. */
export function parseTrailWays(json: unknown): Pt[][] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const ways: Pt[][] = [];
  for (const el of elements as GeomEl[]) {
    const g = el?.geometry;
    if (!Array.isArray(g)) continue;
    const line: Pt[] = [];
    for (const p of g) {
      const lat = Number(p?.lat);
      const lng = Number(p?.lon);
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) line.push([lat, lng]);
    }
    if (line.length >= 2) ways.push(line);
  }
  return ways;
}

const distM = (a: Pt, s: { lat: number; lng: number }): number =>
  distanceFrom({ id: "", name: "", lat: a[0], lng: a[1] }, s) * 1000;

/** Pure: the way whose nearest vertex is closest to the summit, within maxM. */
export function pickNearestTrail(
  ways: Pt[][],
  summit: { lat: number; lng: number },
  maxM = NEAR_SUMMIT_M,
): Pt[] | undefined {
  let best: Pt[] | undefined;
  let bestD = Infinity;
  for (const w of ways) {
    const d = Math.min(...w.map((p) => distM(p, summit)));
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return bestD <= maxM ? best : undefined;
}

/** Pure: downsample a polyline to at most maxPoints, keeping the first + last. */
export function simplifyPath(coords: Pt[], maxPoints = MAX_TRAIL_POINTS): Pt[] {
  if (coords.length <= maxPoints) return coords;
  const step = (coords.length - 1) / (maxPoints - 1);
  const out: Pt[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(coords[Math.round(i * step)]);
  return out;
}

/** Pure: total great-circle length of a polyline, in km. */
export function pathLengthKm(coords: Pt[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += distanceFrom(
      { id: "", name: "", lat: coords[i - 1][0], lng: coords[i - 1][1] },
      { lat: coords[i][0], lng: coords[i][1] },
    );
  }
  return km;
}

const round = (x: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/**
 * Pure: assemble a trail from a (simplified) polyline and its per-vertex
 * elevations. Length always; gain + profile only when every elevation is known.
 */
export function buildTrail(
  coords: Pt[],
  elevs: (number | undefined)[],
): NonNullable<Trek["trail"]> {
  const lengthKm = round(pathLengthKm(coords), 2);
  if (elevs.length !== coords.length || !elevs.every((e) => typeof e === "number")) {
    return { coords, lengthKm, gainM: 0 };
  }
  const nums = elevs as number[];
  let gainM = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] > nums[i - 1]) gainM += nums[i] - nums[i - 1];
  return { coords, lengthKm, gainM: round(gainM), profile: nums.map((e) => round(e)) };
}

/**
 * Best-effort trail for a summit: nearest OSM path, simplified, with length,
 * elevation gain, and a per-vertex profile. Returns undefined when no path is
 * nearby or on any fetch failure.
 */
export interface TrailAndPois {
  trail?: Trek["trail"];
  pois?: Trek["pois"];
}

/**
 * One combined Overpass call per summit fetches both nearby walking paths and
 * trailhead POIs (parking/water/viewpoint), then samples the DEM for the trail's
 * gain/profile. Best-effort: returns {} on failure or when nothing is nearby.
 */
export async function fetchTrailAndPois(
  summit: { lat: number; lng: number },
  fetchElev: (pts: LatLng[]) => Promise<(number | undefined)[]>,
): Promise<TrailAndPois> {
  let raw: unknown;
  try {
    const around = `${summit.lat},${summit.lng}`;
    const query =
      `[out:json][timeout:60];(` +
      `way(around:1200,${around})[highway~"^(path|footway|track|steps)$"];` +
      `node(around:1500,${around})[amenity=parking];` +
      `node(around:1500,${around})[amenity=drinking_water];` +
      `node(around:1500,${around})[natural=spring];` +
      `node(around:1500,${around})[tourism=viewpoint];` +
      `);out geom;`;
    raw = await fetchOverpass(query);
  } catch {
    return {};
  }

  const out: TrailAndPois = {};
  const pois = parsePois(raw, summit);
  if (pois.length > 0) out.pois = pois;

  const picked = pickNearestTrail(parseTrailWays(raw), summit);
  if (picked) {
    const coords = simplifyPath(picked);
    let elevs: (number | undefined)[] = [];
    try {
      elevs = await fetchElev(coords.map(([lat, lng]) => ({ lat, lng })));
    } catch {
      /* keep length; buildTrail leaves gain 0 / no profile */
    }
    out.trail = buildTrail(coords, elevs);
  }
  return out;
}

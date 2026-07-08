/**
 * OSRM road distance + drive time from the origin (spec 02). parseRoute is pure;
 * fetchRoute builds the demo-server URL for a single origin→destination pair.
 */
import type { Origin } from "../../src/lib/trek";
import { fetchJson } from "./http";
import type { LatLng } from "./elevation";

export interface RouteInfo {
  distanceKm: number;
  driveTimeMin: number;
}

interface OsrmResponse {
  routes?: { distance?: unknown; duration?: unknown }[];
}

/** Pure parser: OSRM JSON → { distanceKm, driveTimeMin } or undefined. */
export function parseRoute(json: unknown): RouteInfo | undefined {
  const route = (json as OsrmResponse)?.routes?.[0];
  if (!route) return undefined;
  const meters = Number(route.distance);
  const seconds = Number(route.duration);
  if (!Number.isFinite(meters) || !Number.isFinite(seconds)) return undefined;
  return {
    distanceKm: Math.round((meters / 1000) * 10) / 10,
    driveTimeMin: Math.round(seconds / 60),
  };
}

/** Fetch driving distance/time from origin to a destination point. */
export async function fetchRoute(origin: Origin, dest: LatLng): Promise<RouteInfo | undefined> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
  return parseRoute(await fetchJson(url));
}

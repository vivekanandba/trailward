// Great-circle distance. Pure and framework-free so it unit-tests without React.
// Used by filters (05), the map ring, and the detail card to measure from an origin.
import type { Origin } from "./trek";

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

interface LatLng {
  lat: number;
  lng: number;
}

/** Haversine distance in kilometres between an origin and any lat/lng point. */
export function distanceFrom(origin: Origin, point: LatLng): number {
  const dLat = toRad(point.lat - origin.lat);
  const dLng = toRad(point.lng - origin.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(origin.lat)) * Math.cos(toRad(point.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

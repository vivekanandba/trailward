// Great-circle distance. Pure and framework-free so it unit-tests without React.
// Used by filters (05), the map ring, and the detail card to measure from an origin.
import { DEFAULT_ORIGIN, type Origin, type Trek } from "./trek";

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

/**
 * The origin curated road distances were measured from: build-data asks OSRM
 * for the route from Bengaluru's centre (spec 02). A road distance is a fact
 * about that route only.
 */
export const ROAD_ORIGIN: Origin = DEFAULT_ORIGIN;

// Close enough to be the same start point. A live location even a few hundred
// metres away starts on a different road, so it gets the straight line.
const SAME_START_KM = 0.05;

export interface TripDistance {
  km: number;
  /** True only when `km` is the measured road distance from this origin. */
  byRoad: boolean;
  driveMin?: number;
}

/**
 * How far a trek is from the origin: the baked road distance (and drive time)
 * when the origin is the one it was measured from, otherwise the straight line.
 * Before this, every curated trek reported its distance from Bengaluru whatever
 * the origin — Skandagiri read 67.6 km from Mysuru, which is ~176 km away
 * (spec 44 register row 16, spec 05).
 */
export function tripDistance(origin: Origin, trek: Trek): TripDistance {
  if (trek.distanceKm !== undefined && distanceFrom(origin, ROAD_ORIGIN) <= SAME_START_KM) {
    return trek.driveTimeMin !== undefined
      ? { km: trek.distanceKm, byRoad: true, driveMin: trek.driveTimeMin }
      : { km: trek.distanceKm, byRoad: true };
  }
  return { km: distanceFrom(origin, trek), byRoad: false };
}

/** "~68 km by road · 1 h 16 min drive" or "~176 km in a straight line". */
export function formatTrip(d: TripDistance): string {
  const km = `~${Math.round(d.km)} km`;
  if (!d.byRoad) return `${km} in a straight line`;
  if (d.driveMin === undefined) return `${km} by road`;
  // Round first, so 119.6 min reads "2 h", never "1 h 60 min".
  const total = Math.round(d.driveMin);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const time = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  return `${km} by road · ${time} drive`;
}

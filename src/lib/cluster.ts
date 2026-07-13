// Dependency-free proximity clustering for map markers (spec 04). Groups treks
// into square grid cells of `step` degrees and returns one entry per non-empty
// cell with the centroid + members. Pure (no Leaflet) so it is unit-testable;
// TrekMap only clusters dense sets (e.g. live discovery) at low zoom.
import type { Trek } from "./trek";

export interface TrekCluster {
  lat: number; // centroid latitude
  lng: number; // centroid longitude
  members: Trek[];
}

export function clusterByGrid(treks: Trek[], step: number): TrekCluster[] {
  // A non-positive cell size means "don't cluster" — every trek stands alone.
  if (!(step > 0)) return treks.map((t) => ({ lat: t.lat, lng: t.lng, members: [t] }));

  const cells = new Map<string, Trek[]>();
  for (const t of treks) {
    const key = `${Math.floor(t.lat / step)}:${Math.floor(t.lng / step)}`;
    const arr = cells.get(key);
    if (arr) arr.push(t);
    else cells.set(key, [t]);
  }

  return [...cells.values()].map((members) => ({
    lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
    lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
    members,
  }));
}

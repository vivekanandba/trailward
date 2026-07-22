/**
 * Manually-added peaks (spec 12) — real treks that are NOT tagged as
 * `natural=peak`/`hill` in OpenStreetMap, so discovery can't find them. Edit
 * this list (a maintainer/PR action) to add summits by coordinate; the weekly
 * pipeline scores + enriches them like any discovered peak.
 */
import type { Origin } from "../../src/lib/trek";
import type { ParsedPeak } from "../../src/lib/overpass";
import { distanceFrom } from "../../src/lib/distance";

export interface ManualPeak {
  id: string; // stable slug, prefixed "manual-"
  name: string;
  lat: number;
  lng: number;
  note?: string; // short description → seeds `highlights`
  sourceUrl?: string; // provenance link → the record's sources[0]
}

export const MANUAL_PEAKS: ManualPeak[] = [
  {
    id: "manual-puligundu",
    name: "Puligundu",
    lat: 13.3417,
    lng: 79.2032,
    note: "A granite rock hill near Chittoor with a short, steep scramble to a viewpoint. Added manually — not yet mapped as a peak in OpenStreetMap.",
    sourceUrl: "https://www.openstreetmap.org/#map=16/13.3417/79.2032",
  },
];

/** Manual peaks within radiusKm of the origin, mapped to the ParsedPeak shape. */
export function manualPeaksNear(origin: Origin, radiusKm: number): ParsedPeak[] {
  return MANUAL_PEAKS.filter((m) => distanceFrom(origin, m) <= radiusKm).map((m) => ({
    id: m.id,
    name: m.name,
    lat: m.lat,
    lng: m.lng,
    notability: { hasWikipediaTag: false, hasWikidataTag: false },
    sourceUrl: m.sourceUrl,
    note: m.note,
  }));
}

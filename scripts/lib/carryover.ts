/**
 * How far a record may move and still be the same summit: a terrain rescan
 * shifts a detected peak by at most a few DEM pixels (spec 27). Shared by
 * discovery's preservation, build:data's fold and the drift guard, in a module
 * of its own so none loads another's dependencies to read one rule.
 */
import type { Trek } from "../../src/lib/trek";
import { distanceFrom } from "../../src/lib/distance";

export const CARRYOVER_KM = 0.12; // ~3 z12 pixels

// The previous record is not validated yet: a missing `sources` must read as
// "different", not crash before validation can name the record.
const sourcesOf = (t: Trek): string[] => (Array.isArray(t.sources) ? [...t.sources].sort() : []);

/**
 * Whether a curated record's photo carries from `prev` to `next` (spec 10):
 * the same place and the same cited sources. When it does not, the fold drops
 * the photo on purpose and the drift guard must not call that a loss.
 */
export function photoCarries(prev: Trek, next: Trek): boolean {
  return (
    distanceFrom(prev, next) <= CARRYOVER_KM &&
    JSON.stringify(sourcesOf(prev)) === JSON.stringify(sourcesOf(next))
  );
}

/**
 * What discovery carries from the previous dataset when this run did not
 * produce it (spec 10, spec 25). One list, shared with the drift guard: a
 * same-id record that lost any of these means the carry broke.
 */
export const DISCOVERY_CARRIED = [
  "bestSeason",
  "landCover",
  "historicalNote",
  "hillFeatures",
  "protectedArea",
  "heritage",
  // Fetched best-effort every run (nearest article, nearby Commons photos,
  // nearest town): a lookup that misses this week is not evidence the photo
  // or text is gone. The 2026-11-07 refresh lost 21 photos this way: 16
  // pages that rested on them went too, and a neighbour's lost photo pushed
  // a 17th out of its cell (spec 10).
  "image",
  "gallery",
  "highlights",
  "nearestTown",
] as const;

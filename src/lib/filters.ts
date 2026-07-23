// Pure, framework-free filtering core (spec 05). The map, list, and count all
// derive from applyFilters so they can never disagree.
import { distanceFrom } from "./distance";
import type { Difficulty, Origin, Trek, TrekType } from "./trek";

export interface FilterState {
  radiusKm: number; // default 100
  difficulties: Difficulty[]; // empty = all
  elevation?: [number, number];
  trailLengthMaxKm?: number;
  durationMaxHrs?: number;
  types: TrekType[]; // empty = all
  nightOnly: boolean;
  permitRequired?: boolean; // undefined = any
  query: string; // free-text on name/town
  hiddenGemsOnly: boolean; // discoveryScore >= HIDDEN_GEM_MIN (spec 15)
  minReliefM?: number; // keep peaks with reliefM >= this (rugged filter)
}

// A discovery peak at/above this score counts as a "hidden gem".
export const HIDDEN_GEM_MIN = 0.7;

export const DEFAULT_FILTERS: FilterState = {
  radiusKm: 100,
  difficulties: [],
  types: [],
  nightOnly: false,
  query: "",
  hiddenGemsOnly: false,
};

// Distance from the origin: prefer the precomputed road distance, fall back to
// straight-line haversine when the pipeline didn't supply one (e.g. discovery).
function distanceKmOf(origin: Origin, trek: Trek): number {
  return trek.distanceKm ?? distanceFrom(origin, trek);
}

// "2–3", "3-4 h", "5" → upper bound as a number (NaN if unparseable).
function maxDurationHrs(durationHrs?: string): number {
  if (!durationHrs) return NaN;
  const nums = durationHrs.match(/\d+(?:\.\d+)?/g);
  if (!nums) return NaN;
  return Math.max(...nums.map(Number));
}

/**
 * Return the treks satisfying every active filter (logical AND). A filter at
 * its default (empty array / undefined) imposes no constraint. When a filter
 * IS active, treks missing the relevant field are excluded — documented in
 * spec 05 so "show all" still surfaces unknown-field discovery treks.
 */
export function applyFilters(treks: Trek[], origin: Origin, f: FilterState): Trek[] {
  const q = f.query.trim().toLowerCase();

  return treks.filter((t) => {
    if (distanceKmOf(origin, t) > f.radiusKm) return false;

    if (f.difficulties.length > 0) {
      // Discovery peaks carry a terrain-derived estimatedDifficulty rather than a
      // curated difficulty; fall back to it so the filter still works for them.
      const diff = t.difficulty ?? t.estimatedDifficulty;
      if (!diff || !f.difficulties.includes(diff)) return false;
    }

    if (f.elevation) {
      const [min, max] = f.elevation;
      if (t.elevationM === undefined || t.elevationM < min || t.elevationM > max) return false;
    }

    if (f.types.length > 0) {
      if (!t.type || !t.type.some((ty) => f.types.includes(ty))) return false;
    }

    if (f.nightOnly && t.nightTrek !== true) return false;

    if (f.permitRequired !== undefined && t.permitRequired !== f.permitRequired) return false;

    if (f.trailLengthMaxKm !== undefined) {
      if (t.trailLengthKm === undefined || t.trailLengthKm > f.trailLengthMaxKm) return false;
    }

    if (f.durationMaxHrs !== undefined) {
      const hrs = maxDurationHrs(t.durationHrs);
      if (Number.isNaN(hrs) || hrs > f.durationMaxHrs) return false;
    }

    if (q) {
      const hay = `${t.name} ${t.nearestTown ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (f.hiddenGemsOnly && (t.discoveryScore ?? 0) < HIDDEN_GEM_MIN) return false;

    if (f.minReliefM !== undefined) {
      if (t.reliefM === undefined || t.reliefM < f.minReliefM) return false;
    }

    return true;
  });
}

/** Tally treks by difficulty; treks without a difficulty are not counted. */
export function countByDifficulty(treks: Trek[]): Record<Difficulty, number> {
  const counts: Record<Difficulty, number> = { Easy: 0, Moderate: 0, Hard: 0 };
  for (const t of treks) {
    if (t.difficulty) counts[t.difficulty] += 1;
  }
  return counts;
}

/**
 * Guided paths (spec 38) — curated entry points for the visitor who does not
 * yet know how to phrase what they want.
 *
 * A path is nothing but a filter preset with a reason attached. It hides no
 * data and does nothing the user could not do by hand; that is deliberate,
 * because a shortcut that behaves differently from the controls it stands in
 * for is a second system to learn.
 */
import { DEFAULT_FILTERS, type FilterState } from "./filters";

export interface GuidedPath {
  id: string;
  label: string;
  /** Why this path, in one line — shown beside the chip. */
  reason: string;
  filters: Partial<FilterState>;
}

export const GUIDED_PATHS: GuidedPath[] = [
  {
    id: "sunrise",
    label: "Sunrise trek",
    reason: "Hills people climb before dawn, close enough for a night drive.",
    filters: { nightOnly: true, radiusKm: 100, namedOnly: true },
  },
  {
    id: "first",
    label: "My first hill",
    reason: "Easy, short climbs with a name and a known way up.",
    filters: { difficulties: ["Easy"], namedOnly: true, radiusKm: 100 },
  },
  {
    id: "hard",
    label: "Something hard",
    reason: "Steep, high-relief climbs for a long day out.",
    filters: { difficulties: ["Hard"], minReliefM: 500 },
  },
  {
    id: "gems",
    label: "Hidden gems",
    reason: "Named summits that rank high on terrain and low on footfall.",
    filters: { hiddenGemsOnly: true, namedOnly: true },
  },
];

/**
 * Apply a path over the DEFAULTS, never over the current filters: choosing
 * two paths in a row must give the second path, not an accumulation of both.
 */
export function applyPath(_current: FilterState, path: GuidedPath): FilterState {
  return { ...DEFAULT_FILTERS, ...path.filters };
}

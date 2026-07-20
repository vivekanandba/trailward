// Composite ranking for discovery peaks (spec 11). Pure. Combines a TOPOGRAPHIC
// INTEREST signal (rugged-but-feasible terrain) with an OBSCURITY signal (how
// undocumented the place is) so hidden gems — scenic and lesser-known — rank
// above tall-but-famous or flat peaks.

export interface TerrainInput {
  reliefM: number;
  prominenceProxyM: number;
  meanSlopeDeg: number;
  confidence: number; // [0,1]
}

export interface ObscuritySignals {
  hasWikipediaTag: boolean;
  hasWikidataTag: boolean;
  nearbyAmenityCount: number; // POIs within ~1 km
  wikiArticlesWithin1km: number; // Wikipedia GeoSearch count; -1 = not looked up
}

export interface ScoreWeights {
  // Within the topo block (sum ~1):
  relief: number;
  prominence: number;
  slope: number;
  // Block weights (sum ~1):
  topo: number;
  obscurity: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  relief: 0.4,
  prominence: 0.4,
  slope: 0.2,
  topo: 0.6,
  obscurity: 0.4,
};

// Amenity count at/above which a place counts as fully "developed" (obscurity 0).
const AMENITY_SATURATION = 10;

/**
 * Trapezoidal membership: 0 outside [lo, hi], ramps up across [lo, a], flat 1 on
 * [a, b], ramps down across [b, hi]. A zero-width ramp (lo===a or b===hi) acts as
 * a hard step instead of dividing by zero.
 */
export function band(x: number, lo: number, a: number, b: number, hi: number): number {
  // Plateau first, so a degenerate ramp (lo===a or b===hi) reads as a hard step
  // at the boundary rather than dividing by zero on the ramp branches below.
  if (x >= a && x <= b) return 1;
  if (x <= lo || x >= hi) return 0;
  return x < a ? (x - lo) / (a - lo) : (hi - x) / (hi - b);
}

/**
 * Rank score in [0,1]. Topo uses adventurous-but-feasible bands (flat AND
 * dangerously extreme both score low), discounted by DEM confidence; obscurity
 * rewards missing wiki tags, no nearby article, and low amenity density.
 */
export function scoreDiscovery(
  t: TerrainInput,
  o: ObscuritySignals,
  w: ScoreWeights = DEFAULT_WEIGHTS,
): { score: number; topoScore: number; obscurityScore: number } {
  const reliefScore = band(t.reliefM, 40, 200, 800, 1500);
  const prominenceScore = band(t.prominenceProxyM, 30, 120, 500, 1200);
  const slopeScore = band(t.meanSlopeDeg, 8, 15, 35, 50);

  const topoRaw = w.relief * reliefScore + w.prominence * prominenceScore + w.slope * slopeScore;
  const topoScore = topoRaw * (0.5 + 0.5 * clamp01(t.confidence));

  const noWikiTag = !o.hasWikipediaTag && !o.hasWikidataTag ? 1 : 0;
  const lowAmenity = 1 - Math.min(1, Math.max(0, o.nearbyAmenityCount) / AMENITY_SATURATION);
  const noArticle = o.wikiArticlesWithin1km < 0 ? 0.5 : o.wikiArticlesWithin1km === 0 ? 1 : 0;
  const obscurityScore = 0.4 * noWikiTag + 0.3 * lowAmenity + 0.3 * noArticle;

  return {
    topoScore,
    obscurityScore,
    score: w.topo * topoScore + w.obscurity * obscurityScore,
  };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

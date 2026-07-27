/**
 * Climate-derived season guidance (spec 20). Rainfall dominates when a South
 * Indian hill is pleasant to climb, so we derive each peak's driest stretch from
 * mean monthly rainfall rather than guessing a season.
 *
 * Rainfall is sampled on a coarse grid (climate varies slowly over space, and
 * ~540 cells cover every peak we ship) and keyed by cell, so the 12 monthly
 * numbers are stored once per cell instead of duplicated onto 7,800 treks.
 * Pure + client-usable: the build bakes `bestSeason`, the detail panel reads the
 * same functions to draw the rainfall profile.
 */

/** Grid resolution for climate sampling (~28 km). */
export const CLIMATE_CELL_DEG = 0.25;

export type MonthlyRain = number[]; // 12 entries, mean mm/month, Jan→Dec

/** Stable key for the climate cell containing a coordinate. */
export function climateCellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / CLIMATE_CELL_DEG)}:${Math.floor(lng / CLIMATE_CELL_DEG)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A month counts as dry below half the local mean, with an absolute floor so a
// genuinely arid place doesn't get a threshold near zero (and so reads as
// year-round rather than having an arbitrary "wet" season).
const DRY_FLOOR_MM = 25;

/**
 * Indices (0=Jan) of the longest run of consecutive dry months, wrapping across
 * December→January. Empty when no month is dry (no clear season).
 */
export function driestMonths(monthly: MonthlyRain): number[] {
  if (monthly.length !== 12 || monthly.some((m) => !Number.isFinite(m))) return [];
  const mean = monthly.reduce((a, b) => a + b, 0) / 12;
  const threshold = Math.max(DRY_FLOOR_MM, mean * 0.5);
  const dry = monthly.map((m) => m < threshold);
  if (dry.every((d) => d)) return monthly.map((_, i) => i);
  if (dry.every((d) => !d)) return [];

  let best: number[] = [];
  let run: number[] = [];
  // Two passes so a run wrapping Dec→Jan is seen contiguously.
  for (let i = 0; i < 24; i++) {
    if (dry[i % 12]) {
      run.push(i % 12);
      if (run.length > best.length && run.length <= 12) best = [...run];
    } else {
      run = [];
    }
  }
  return best;
}

/**
 * Human-readable driest stretch, e.g. "Dec–Apr (driest)" — phrased as an
 * observation about rainfall, not a promise about trekking conditions.
 * Returns undefined when the rainfall pattern has no clear dry season.
 */
export function bestSeasonFrom(monthly: MonthlyRain): string | undefined {
  const dry = driestMonths(monthly);
  if (dry.length === 0) return undefined;
  if (dry.length >= 11) return "Year-round (little rain)";
  const start = MONTHS[dry[0]];
  const end = MONTHS[dry[dry.length - 1]];
  return dry.length === 1 ? `${start} (driest)` : `${start}–${end} (driest)`;
}

/** Wettest month index + amount, for an "avoid" hint. */
export function wettestMonth(monthly: MonthlyRain): { month: string; mm: number } | undefined {
  if (monthly.length !== 12) return undefined;
  let idx = 0;
  for (let i = 1; i < 12; i++) if (monthly[i] > monthly[idx]) idx = i;
  return { month: MONTHS[idx], mm: Math.round(monthly[idx]) };
}

export { MONTHS };

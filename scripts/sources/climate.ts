/**
 * Monthly rainfall normals from the Open-Meteo archive (spec 20). Free, no key.
 * Sampled once per climate grid cell (not per peak) and batched many locations
 * per request, so every peak we ship is covered by a few dozen calls.
 */
import type { MonthlyRain } from "../../src/lib/climate";
import { fetchJson } from "./http";

// Two full years: monsoon timing is very stable in South India, and Open-Meteo's
// rate limit is weighted by locations × days, so a shorter window costs less.
const START = "2022-01-01";
const END = "2023-12-31";
const YEARS = 2;
/** Locations per request — Open-Meteo accepts comma-separated coordinate lists. */
export const BATCH = 10;
// Open-Meteo enforces a *per-minute* weighted limit; at 10 locations × 2 years a
// ~12 s gap keeps us under it (http.ts additionally waits out any 429).
const THROTTLE_MS = 12_000;

interface ArchiveLocation {
  daily?: { time?: unknown; precipitation_sum?: unknown };
}

/**
 * Pure: one archive location's daily series → 12 mean monthly totals. Returns
 * undefined if the series is unusable, so a bad cell is skipped, not faked.
 */
export function parseMonthlyRain(loc: unknown, years = YEARS): MonthlyRain | undefined {
  const daily = (loc as ArchiveLocation)?.daily;
  const time = daily?.time;
  const rain = daily?.precipitation_sum;
  if (!Array.isArray(time) || !Array.isArray(rain) || time.length !== rain.length) return undefined;
  if (time.length === 0) return undefined;

  const totals = Array<number>(12).fill(0);
  for (let i = 0; i < time.length; i++) {
    const day = String(time[i]);
    const month = Number(day.slice(5, 7));
    const mm = Number(rain[i]);
    if (month >= 1 && month <= 12 && Number.isFinite(mm)) totals[month - 1] += mm;
  }
  return totals.map((t) => Math.round((t / years) * 10) / 10);
}

/** Pure: a multi-location archive response → per-location monthly rain, in order. */
export function parseArchiveBatch(json: unknown, years = YEARS): (MonthlyRain | undefined)[] {
  const locs = Array.isArray(json) ? json : [json];
  return locs.map((l) => parseMonthlyRain(l, years));
}

export interface CellPoint {
  key: string;
  lat: number;
  lng: number;
}

/**
 * Fetch mean monthly rainfall for each cell (batched). Best-effort per batch: a
 * failed batch leaves those cells absent rather than aborting the whole build.
 */
export async function fetchMonthlyRain(
  cells: CellPoint[],
  getJson: (url: string) => Promise<unknown> = (url) =>
    fetchJson(url, {
      throttleMs: THROTTLE_MS,
      timeoutMs: 60_000,
      retries: 3,
      waitOutRateLimit: true, // Open-Meteo limits per minute
    }),
): Promise<Map<string, MonthlyRain>> {
  const out = new Map<string, MonthlyRain>();
  for (let i = 0; i < cells.length; i += BATCH) {
    const batch = cells.slice(i, i + BATCH);
    const url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${batch.map((c) => c.lat.toFixed(4)).join(",")}` +
      `&longitude=${batch.map((c) => c.lng.toFixed(4)).join(",")}` +
      `&start_date=${START}&end_date=${END}&daily=precipitation_sum&timezone=GMT`;
    try {
      const parsed = parseArchiveBatch(await getJson(url));
      batch.forEach((c, j) => {
        const m = parsed[j];
        if (m) out.set(c.key, m);
      });
      console.log(
        `[climate]   ${Math.min(i + BATCH, cells.length)}/${cells.length} cells (${out.size} ok)…`,
      );
    } catch (err) {
      console.warn(
        `[climate] batch ${i / BATCH + 1} failed (${(err as Error).message}); cells skipped`,
      );
    }
  }
  return out;
}

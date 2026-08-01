/**
 * Spatial cell chunking (spec 30). A nationwide dataset is far too large to
 * ship as one blob, and a user only ever looks at one radius at a time — so
 * treks are served as 1°×1° cell files (public/data/cells/<lat>_<lng>.json)
 * plus a tiny index of non-empty cells. The app fetches exactly the cells the
 * current origin+radius touches and caches them for the session.
 *
 * Pure maths here; the fetch shell is in loadCells (injectable for tests).
 */
import type { Trek } from "./trek";

export const CELL_DEG = 1;

/** Cell key for a coordinate, e.g. "12_77" (floor — stable for negatives too). */
export function cellKeyFor(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL_DEG)}_${Math.floor(lng / CELL_DEG)}`;
}

/**
 * Keys of every cell a radius around the origin could intersect. Conservative
 * (bounding square + 1-cell latitude margin for longitude shrink) — extra keys
 * cost nothing because only index-listed cells are fetched.
 */
export function cellKeysAround(lat: number, lng: number, radiusKm: number): string[] {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const out: string[] = [];
  for (let y = Math.floor(lat - dLat); y <= Math.floor(lat + dLat); y += CELL_DEG) {
    for (let x = Math.floor(lng - dLng); x <= Math.floor(lng + dLng); x += CELL_DEG) {
      out.push(`${y}_${x}`);
    }
  }
  return out;
}

export interface CellIndex {
  /** Non-empty cell keys with record counts (informational). */
  cells: Record<string, number>;
}

type FetchJson = (path: string) => Promise<unknown>;

const defaultFetch: FetchJson = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
};

// Session caches: the index is one fetch ever; each cell at most once.
let indexCache: CellIndex | null = null;
const cellCache = new Map<string, Trek[]>();

/** Base path under the site root (works under a GH Pages subpath). Typed via
 *  cast so this module also compiles under the scripts (node) tsconfig, which
 *  doesn't load vite/client. */
const base = (): string => {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return `${env?.BASE_URL ?? "/"}data/cells`;
};

/**
 * Load every trek within reach of the origin+radius: index once, then the
 * intersecting non-empty cells in parallel. A cell that fails to fetch is
 * retried on the next call (it just isn't cached). Returns a flat list —
 * `applyFilters` still does the exact radius cut.
 */
export async function loadTreksAround(
  lat: number,
  lng: number,
  radiusKm: number,
  getJson: FetchJson = defaultFetch,
): Promise<Trek[]> {
  if (!indexCache) {
    indexCache = (await getJson(`${base()}/index.json`)) as CellIndex;
  }
  const wanted = cellKeysAround(lat, lng, radiusKm).filter(
    (k) => indexCache!.cells[k] !== undefined,
  );
  await Promise.all(
    wanted
      .filter((k) => !cellCache.has(k))
      .map(async (k) => {
        try {
          cellCache.set(k, (await getJson(`${base()}/${k}.json`)) as Trek[]);
        } catch {
          // leave uncached → retried next call
        }
      }),
  );
  return wanted.flatMap((k) => cellCache.get(k) ?? []);
}

/** Test hook: drop session caches. */
export function resetCellCache(): void {
  indexCache = null;
  cellCache.clear();
}

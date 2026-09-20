/**
 * build-climate — occasional build tool (NOT the weekly cron). Samples mean
 * monthly rainfall on a coarse grid covering every trek we ship (Open-Meteo
 * archive, free/no key), writes src/data/climate.json keyed by grid cell, and
 * bakes a `bestSeason` string onto treks that don't already carry a curated one.
 *
 * Climate normals move on decade scales, so re-run by hand when the dataset
 * gains new regions:  npm run build:climate
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import {
  climateCellKey,
  bestSeasonFrom,
  CLIMATE_CELL_DEG,
  type MonthlyRain,
} from "../src/lib/climate";
import { fetchMonthlyRain, type CellPoint } from "./sources/climate";
import { nodeIO, type BuildIO } from "./lib/buildIO";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Paths derived from the repo root, never named by the caller (CON-PROC-006). */
export function climatePathsFor(root: string): { treks: string; climate: string } {
  const r = root.replace(/\/+$/, "");
  if (!r.startsWith("/") || r.split("/").includes("..")) {
    throw new Error(`refusing to build climate: ${root} is not an absolute repo root`);
  }
  return { treks: `${r}/src/data/treks.json`, climate: `${r}/src/data/climate.json` };
}

/** The network, injected (spec 41 §A). Tests supply a plain function. */
export interface ClimateDeps {
  fetchRain: (cells: CellPoint[]) => Promise<Map<string, MonthlyRain>>;
}

/** Distinct climate cells covering the treks, sampled at each cell's centre. */
export function cellsFor(treks: Trek[]): CellPoint[] {
  const seen = new Map<string, CellPoint>();
  for (const t of treks) {
    const key = climateCellKey(t.lat, t.lng);
    if (seen.has(key)) continue;
    const [gy, gx] = key.split(":").map(Number);
    seen.set(key, {
      key,
      lat: (gy + 0.5) * CLIMATE_CELL_DEG,
      lng: (gx + 0.5) * CLIMATE_CELL_DEG,
    });
  }
  return [...seen.values()];
}

export async function runBuildClimate(
  io: BuildIO,
  root: string,
  deps: ClimateDeps,
): Promise<{ cells: number; fetched: number; baked: number }> {
  const paths = climatePathsFor(root);
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];
  const allCells = cellsFor(treks);

  // Resume on the VALUE, not on a record of an attempt (spec 41 §B.7): a cell
  // counts as sampled only because its rainfall is present, so re-running
  // after a rate-limit window makes progress and a complete re-run does none.
  let existing: Record<string, MonthlyRain> = {};
  if (io.exists(paths.climate)) {
    try {
      existing = JSON.parse(io.readFile(paths.climate)) as Record<string, MonthlyRain>;
    } catch {
      existing = {};
    }
  }
  const cells = allCells.filter((c) => !existing[c.key]);
  io.log(
    `[climate] ${allCells.length} cells cover ${treks.length} treks; ` +
      `${allCells.length - cells.length} already sampled, fetching ${cells.length}…`,
  );

  const rain = cells.length > 0 ? await deps.fetchRain(cells) : new Map<string, MonthlyRain>();
  io.log(`[climate] got rainfall for ${rain.size}/${cells.length} new cells.`);
  if (rain.size === 0 && Object.keys(existing).length === 0) {
    // Nothing fetched and nothing banked: writing now would replace the
    // dataset's seasons with emptiness (spec 41 §B.6).
    throw new Error("no rainfall data returned; refusing to write");
  }

  const merged: Record<string, MonthlyRain> = { ...existing };
  for (const [k, v] of rain) merged[k] = v;

  // Bank the rainfall NOW, before anything that can refuse. climate.json is a
  // strictly additive observation cache: it is a superset of what was there, so
  // writing it destroys nothing. Making it conditional on treks.json validating
  // would throw away hours of rate-limited sampling because of an unrelated
  // dataset problem, and the next run would re-fetch from zero.
  io.writeFile(paths.climate, JSON.stringify(merged) + "\n");
  io.log(`[climate] wrote ${Object.keys(merged).length} cells → ${paths.climate}`);

  // Bake bestSeason for discovery peaks. Curated treks keep their hand-written
  // guidance; auto-derived ones are always recomputed, so improving the climate
  // sample and re-running actually refreshes them (rather than sticking at
  // whatever the first, possibly partial, run produced).
  let baked = 0;
  const next = treks.map((t) => {
    if (t.tier === "curated" && t.bestSeason) return t;
    const monthly = merged[climateCellKey(t.lat, t.lng)];
    const season = monthly ? bestSeasonFrom(monthly) : undefined;
    if (!season) return t;
    baked++;
    return { ...t, bestSeason: season };
  });

  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[climate] dataset invalid: ${ds.error}`);

  // ---- Nothing below can refuse. ----
  io.writeFile(paths.treks, JSON.stringify(ds.treks) + "\n");
  io.log(`[climate] baked bestSeason onto ${baked} treks.`);
  return { cells: allCells.length, fetched: rain.size, baked };
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBuildClimate(nodeIO, repoRoot, { fetchRain: (cells) => fetchMonthlyRain(cells) }).catch(
    (err) => {
      console.error((err as Error).message);
      process.exit(1);
    },
  );
}

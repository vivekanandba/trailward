/**
 * build-climate — occasional build tool (NOT the weekly cron). Samples mean
 * monthly rainfall on a coarse grid covering every trek we ship (Open-Meteo
 * archive, free/no key), writes src/data/climate.json keyed by grid cell, and
 * bakes a `bestSeason` string onto treks that don't already carry a curated one.
 *
 * Climate normals move on decade scales, so re-run by hand when the dataset
 * gains new regions:  npm run build:climate
 */
import { readFileSync, writeFileSync } from "node:fs";
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

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const climateFile = resolve(here, "../src/data/climate.json");

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

async function main(): Promise<void> {
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const allCells = cellsFor(treks);

  // Resume: cells already sampled are skipped, so this can be re-run across
  // rate-limit windows until coverage is complete (Open-Meteo limits per minute).
  let existing: Record<string, MonthlyRain> = {};
  try {
    existing = JSON.parse(readFileSync(climateFile, "utf8")) as Record<string, MonthlyRain>;
  } catch {
    existing = {};
  }
  const cells = allCells.filter((c) => !existing[c.key]);
  console.log(
    `[climate] ${allCells.length} cells cover ${treks.length} treks; ` +
      `${allCells.length - cells.length} already sampled, fetching ${cells.length}…`,
  );

  const rain = cells.length > 0 ? await fetchMonthlyRain(cells) : new Map();
  console.log(`[climate] got rainfall for ${rain.size}/${cells.length} new cells.`);
  if (rain.size === 0 && Object.keys(existing).length === 0) {
    throw new Error("no rainfall data returned; refusing to write");
  }

  const merged: Record<string, MonthlyRain> = { ...existing };
  for (const [k, v] of rain) merged[k] = v;
  writeFileSync(climateFile, JSON.stringify(merged) + "\n", "utf8");
  console.log(`[climate] wrote ${Object.keys(merged).length} cells → ${climateFile}`);

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
  writeFileSync(treksFile, JSON.stringify(ds.treks) + "\n", "utf8");
  console.log(`[climate] baked bestSeason onto ${baked} treks.`);
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

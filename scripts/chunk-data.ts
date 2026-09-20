/**
 * chunk-data — derive the cell files the app serves (spec 30) from the
 * canonical src/data/treks.json: public/data/cells/<key>.json per 1° cell plus
 * index.json listing non-empty cells. Runs after any data build (and in the
 * weekly cron) so the served chunks never drift from the dataset.
 *   npm run build:chunks
 *
 * The work lives in `runChunkData(io, paths)` behind an I/O seam (spec 40), so
 * its contract — every record placed exactly once, a clean rebuild, a truthful
 * summary, byte-stable output — is asserted by tests rather than assumed.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { cellKeyFor } from "../src/lib/cells";
import { nodeIO, type BuildIO } from "./lib/buildIO";

const here = dirname(fileURLToPath(import.meta.url));

export interface ChunkPaths {
  treks: string;
  out: string;
}

/**
 * Derived from the repo root so the recursive clean below cannot be aimed at a
 * directory of the caller's choosing (CON-PROC-006).
 */
export function chunkPathsFor(repoRoot: string): ChunkPaths {
  const root = repoRoot.replace(/\/+$/, "");
  if (!root.startsWith("/") || root.split("/").includes("..")) {
    throw new Error(`refusing to chunk: ${repoRoot} is not an absolute repo root`);
  }
  return { treks: `${root}/src/data/treks.json`, out: `${root}/public/data/cells` };
}

export function runChunkData(io: BuildIO, repoRoot: string): void {
  const paths = chunkPathsFor(repoRoot);
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];
  // Two distinct failures, two distinct messages: reporting a wrong SHAPE as
  // "empty" sends the reader after a problem they do not have (CON-VER-005).
  if (!Array.isArray(treks)) {
    throw new Error("[chunks] refusing to write: the dataset is not an array");
  }
  if (treks.length === 0) {
    // An empty bake would erase every served cell and take the app down while
    // reporting success. Leave the previous chunks alone and fail loudly.
    throw new Error("[chunks] refusing to write: the dataset is empty");
  }

  const cells = new Map<string, Trek[]>();
  for (const t of treks) {
    const k = cellKeyFor(t.lat, t.lng);
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(t);
  }

  // Clean rebuild so cells emptied by a scrub actually disappear.
  io.removeDir(paths.out, repoRoot);

  // Sorted so the committed artefacts diff cleanly between builds.
  const index: Record<string, number> = {};
  for (const k of [...cells.keys()].sort()) {
    const list = cells.get(k)!;
    index[k] = list.length;
    io.writeFile(`${paths.out}/${k}.json`, `${JSON.stringify(list)}\n`);
  }
  io.writeFile(`${paths.out}/index.json`, `${JSON.stringify({ cells: index })}\n`);
  io.log(`[chunks] wrote ${cells.size} cells (+index) for ${treks.length} treks → ${paths.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runChunkData(nodeIO, resolve(here, ".."));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

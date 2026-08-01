/**
 * chunk-data — derive the cell files the app serves (spec 30) from the
 * canonical src/data/treks.json: public/data/cells/<key>.json per 1° cell plus
 * index.json listing non-empty cells. Runs after any data build (and in the
 * weekly cron) so the served chunks never drift from the dataset.
 *   npm run build:chunks
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { cellKeyFor } from "../src/lib/cells";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const outDir = resolve(here, "../public/data/cells");

async function main(): Promise<void> {
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const cells = new Map<string, Trek[]>();
  for (const t of treks) {
    const k = cellKeyFor(t.lat, t.lng);
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(t);
  }

  // Clean rebuild so removed cells disappear.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const index: Record<string, number> = {};
  for (const [k, list] of cells) {
    index[k] = list.length;
    writeFileSync(resolve(outDir, `${k}.json`), JSON.stringify(list) + "\n", "utf8");
  }
  writeFileSync(resolve(outDir, "index.json"), JSON.stringify({ cells: index }) + "\n", "utf8");
  const files = readdirSync(outDir).length;
  console.log(`[chunks] wrote ${files - 1} cells (+index) for ${treks.length} treks → ${outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

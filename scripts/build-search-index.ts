/**
 * build-search-index — emits public/data/search-index.json (spec 38): one
 * entry per NAMED trek, so the palette can find a summit anywhere in India
 * rather than only among the ~300 rows loaded around the current origin.
 *
 * The ~101k "Unnamed" pins are excluded: they have nothing to search for and
 * would drown every real result. The file is fetched lazily on first palette
 * open, never bundled.
 */
import { nodeIO, type BuildIO } from "./lib/buildIO";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import type { IndexEntry } from "../src/lib/search";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const outFile = resolve(here, "../public/data/search-index.json");

/** Pure: the entries a dataset contributes to the palette index. */
export function buildIndex(treks: Trek[]): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const t of treks) {
    if (t.name.startsWith("Unnamed")) continue;
    const entry: IndexEntry = {
      id: t.id,
      name: t.name,
      lat: Math.round(t.lat * 1e4) / 1e4,
      lng: Math.round(t.lng * 1e4) / 1e4,
    };
    if (t.altNames?.length) entry.alt = t.altNames;
    if (t.elevationM !== undefined) entry.elevationM = t.elevationM;
    if (t.discoveryScore !== undefined) entry.score = t.discoveryScore;
    out.push(entry);
  }
  // Stable order so the committed artifact diffs cleanly between builds.
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function runBuildSearchIndex(
  io: BuildIO,
  paths: { treks: string; out: string },
): IndexEntry[] {
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];
  const index = buildIndex(treks);
  if (index.length === 0) {
    // Every named summit vanishing means the dataset or the filter broke;
    // shipping an empty index silently disables the palette.
    throw new Error("[search] refusing to write: no named summits in the dataset");
  }
  const body = JSON.stringify(index);
  io.writeFile(paths.out, body);
  io.log(
    `[search] wrote ${index.length} named entries (${Math.round(Buffer.byteLength(body) / 1024)} KB) → ${paths.out}`,
  );
  return index;
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runBuildSearchIndex(nodeIO, { treks: treksFile, out: outFile });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

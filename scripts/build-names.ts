/**
 * build-names — occasional build tool (NOT the weekly cron). Names terrain-
 * detected summits from the GeoNames features around them (spec 28): the
 * reserved forest / temple / pass that carries the hill's own name. Updates
 * the committed scripts/detected/india-detected.json in place (name +
 * provenance), then patches any already-baked d12- records in treks.json.
 *
 * Zero network: reads the cached GeoNames dump.
 *   npm run build:names
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { distanceFrom } from "../src/lib/distance";
import {
  inferName,
  NAMER_CODES,
  VILLAGE_NAMER_CODES,
  type NamerFeature,
} from "./sources/nameinfer";
import type { DetectedSummit } from "./build-detect";
import { nodeIO, type BuildIO } from "./lib/buildIO";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Paths derived from the repo root, never named by the caller (CON-PROC-006). */
export function namesPathsFor(root: string): { detected: string; dump: string; treks: string } {
  const r = root.replace(/\/+$/, "");
  if (!r.startsWith("/") || r.split("/").includes("..")) {
    throw new Error(`refusing to build names: ${root} is not an absolute repo root`);
  }
  return {
    detected: `${r}/scripts/detected/india-detected.json`,
    dump: `${r}/scripts/geonames/.cache/IN.txt`,
    treks: `${r}/src/data/treks.json`,
  };
}

/**
 * The namer grid, injected (spec 41 §A). The real one streams a 400 MB
 * GeoNames dump; a test supplies the parsed grid directly.
 */
export interface NamesDeps {
  loadGrid: () => Promise<Map<string, NamerFeature[]>>;
}

const CELL = 0.012; // ~1.3 km buckets: covers the largest namer radius

/** Parse one GeoNames dump line into a namer feature, or null if unusable. */
export function namerFeatureFrom(line: string): NamerFeature | null {
  const c = line.split("\t");
  if (!NAMER_CODES[c[7]] && !VILLAGE_NAMER_CODES[c[7]]) return null;
  // Number("") is 0, not NaN — a blank coordinate would place the feature at
  // 0°E in the Atlantic rather than being skipped. A missing value must never
  // become a real one (CON-DATA-001).
  if (!c[4]?.trim() || !c[5]?.trim() || !c[1]) return null;
  const lat = Number(c[4]);
  const lng = Number(c[5]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { name: c[1], code: c[7], lat, lng };
}

/** The bucket a feature or summit falls in. Exported so tests can build a grid. */
export function cellKeyFor(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
}

export async function loadNamerFeatures(dumpFile: string): Promise<Map<string, NamerFeature[]>> {
  const grid = new Map<string, NamerFeature[]>();
  const rl = createInterface({ input: createReadStream(dumpFile, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const f = namerFeatureFrom(line);
    if (!f) continue;
    const key = cellKeyFor(f.lat, f.lng);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(f);
  }
  return grid;
}

export function featuresNear(
  grid: Map<string, NamerFeature[]>,
  lat: number,
  lng: number,
): NamerFeature[] {
  const bx = Math.floor(lat / CELL);
  const by = Math.floor(lng / CELL);
  const out: NamerFeature[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      out.push(...(grid.get(`${bx + dx}:${by + dy}`) ?? []));
    }
  }
  return out;
}

const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number =>
  distanceFrom({ id: "", name: "", ...a }, b);

export async function runBuildNames(
  io: BuildIO,
  root: string,
  deps: NamesDeps,
): Promise<{ named: number; patched: number; total: number }> {
  const paths = namesPathsFor(root);
  const grid = await deps.loadGrid();
  const summits = JSON.parse(io.readFile(paths.detected)) as (DetectedSummit & {
    inferredFrom?: string;
  })[];

  if (grid.size === 0 && summits.length > 0) {
    // An empty namer grid means the dump is missing or unparsed, not that
    // India has no place names. Writing now would bank "nothing named" as a
    // result and the next run would skip nothing (spec 41 §C).
    throw new Error("[names] refusing to write: the namer grid is empty");
  }

  let named = 0;
  const next = summits.map((s) => {
    const hit = inferName(s, featuresNear(grid, s.lat, s.lng), dist);
    // Never overwrite a name a human suggested (future manual naming keeps
    // "Unnamed" out of the string, so the startsWith guard protects it).
    if (!hit || !s.name.startsWith("Unnamed")) return s;
    named++;
    return {
      ...s,
      name: hit.name,
      inferredFrom: `Name inferred from the adjacent '${hit.from}' (GeoNames, ~${hit.km.toFixed(1)} km); unverified.`,
    };
  });

  // Patch already-baked d12- records in place (keeps all other fields).
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];
  const byId = new Map(next.map((s) => [s.id, s]));
  let patched = 0;
  const nextTreks = treks.map((t) => {
    if (!t.id.startsWith("d12-")) return t;
    const s = byId.get(t.id);
    if (!s || !s.inferredFrom || t.name === s.name) return t;
    patched++;
    return { ...t, name: s.name, highlights: s.inferredFrom };
  });
  const ds = validateDataset(nextTreks);
  if (!ds.ok) throw new Error(`[names] dataset invalid: ${ds.error}`);

  // ---- Everything above can refuse. Everything below only writes. ----
  io.writeFile(paths.detected, JSON.stringify(next) + "\n");
  io.log(`[names] inferred names for ${named}/${summits.length} detected summits.`);
  io.writeFile(paths.treks, JSON.stringify(ds.treks) + "\n");
  io.log(`[names] patched ${patched} baked records.`);
  for (const s of next.filter((x) => x.inferredFrom).slice(0, 10)) {
    io.log(`  · ${s.name}  ← ${s.inferredFrom!.slice(25, 80)}`);
  }
  return { named, patched, total: summits.length };
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBuildNames(nodeIO, repoRoot, {
    loadGrid: () => loadNamerFeatures(namesPathsFor(repoRoot).dump),
  }).catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

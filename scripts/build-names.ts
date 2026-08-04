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
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { distanceFrom } from "../src/lib/distance";
import { inferName, NAMER_CODES, type NamerFeature } from "./sources/nameinfer";
import type { DetectedSummit } from "./build-detect";

const here = dirname(fileURLToPath(import.meta.url));
const detectedFile = resolve(here, "detected/india-detected.json");
const dumpFile = resolve(here, "geonames/.cache/IN.txt");
const treksFile = resolve(here, "../src/data/treks.json");

const CELL = 0.012; // ~1.3 km buckets: covers the largest namer radius

async function loadNamerFeatures(): Promise<Map<string, NamerFeature[]>> {
  const grid = new Map<string, NamerFeature[]>();
  const rl = createInterface({ input: createReadStream(dumpFile, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split("\t");
    if (!NAMER_CODES[c[7]]) continue;
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (Number.isNaN(lat) || Number.isNaN(lng) || !c[1]) continue;
    const key = `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push({ name: c[1], code: c[7], lat, lng });
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

async function main(): Promise<void> {
  const grid = await loadNamerFeatures();
  const summits = JSON.parse(readFileSync(detectedFile, "utf8")) as (DetectedSummit & {
    inferredFrom?: string;
  })[];

  let named = 0;
  const provenance = new Map<string, string>(); // summit id → provenance sentence
  for (const s of summits) {
    const hit = inferName(s, featuresNear(grid, s.lat, s.lng), dist);
    // Never overwrite a name a human suggested (future manual naming keeps
    // "Unnamed" out of the string, so the startsWith guard protects it).
    if (!hit || !s.name.startsWith("Unnamed")) continue;
    s.name = hit.name;
    s.inferredFrom = `Name inferred from the adjacent '${hit.from}' (GeoNames, ~${hit.km.toFixed(1)} km); unverified.`;
    provenance.set(s.id, s.inferredFrom);
    named++;
  }
  writeFileSync(detectedFile, JSON.stringify(summits) + "\n", "utf8");
  console.log(`[names] inferred names for ${named}/${summits.length} detected summits.`);

  // Patch already-baked d12- records in place (keeps all other fields).
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const byId = new Map(summits.map((s) => [s.id, s]));
  let patched = 0;
  const next = treks.map((t) => {
    if (!t.id.startsWith("d12-")) return t;
    const s = byId.get(t.id);
    if (!s || !s.inferredFrom || t.name === s.name) return t;
    patched++;
    return { ...t, name: s.name, highlights: s.inferredFrom };
  });
  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[names] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks) + "\n", "utf8");
  console.log(`[names] patched ${patched} baked records.`);
  for (const s of summits.filter((x) => x.inferredFrom).slice(0, 10)) {
    console.log(`  · ${s.name}  ← ${s.inferredFrom!.slice(25, 80)}`);
  }
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

/**
 * build-landcover — occasional build tool (NOT the weekly cron). Samples ESA
 * WorldCover 10 m land cover around every trek's summit (centre + 150 m
 * rosette at the ~40 m overview) and bakes the dominant class as `landCover`.
 *
 * Cheap by construction: internal COG tiles cover ~41 km at that overview, so
 * all ~7,800 treks resolve from a few hundred range reads, cached in memory.
 *   npm run build:landcover
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { rosetteRing } from "../src/lib/terrain";
import { createWorldCover, dominantLabel } from "./sources/worldcover";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");

// Tight ring: 450 m (the DEM rosette) reaches the forested lower slopes and
// mislabels a bare summit; 150 m describes what the top of the climb is like.
const RING_M = 150;

async function main(): Promise<void> {
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const wc = createWorldCover({ level: 2 });

  let baked = 0;
  const next: Trek[] = [];
  for (let i = 0; i < treks.length; i++) {
    const t = treks[i];
    const pts = [{ lat: t.lat, lng: t.lng }, ...rosetteRing({ lat: t.lat, lng: t.lng }, RING_M)];
    const classes = await wc.classesAt(pts);
    const label = dominantLabel(classes.filter((c): c is number => c !== undefined));
    if (label) {
      next.push({ ...t, landCover: label });
      baked++;
    } else {
      // No reading → drop any stale value rather than keep a wrong one.
      const copy = { ...t };
      delete copy.landCover;
      next.push(copy);
    }
    if ((i + 1) % 1000 === 0) console.log(`[landcover]   ${i + 1}/${treks.length}…`);
  }

  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[landcover] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  const counts = new Map<string, number>();
  for (const t of ds.treks) {
    if (t.landCover) counts.set(t.landCover, (counts.get(t.landCover) ?? 0) + 1);
  }
  console.log(`[landcover] baked landCover onto ${baked}/${treks.length} treks:`);
  for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${n}`);
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

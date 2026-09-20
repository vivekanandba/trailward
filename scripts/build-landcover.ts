/**
 * build-landcover — occasional build tool (NOT the weekly cron). Samples ESA
 * WorldCover 10 m land cover around every trek's summit (centre + 150 m
 * rosette at the ~40 m overview) and bakes the dominant class as `landCover`.
 *
 * Cheap by construction: internal COG tiles cover ~41 km at that overview, so
 * all ~7,800 treks resolve from a few hundred range reads, cached in memory.
 *   npm run build:landcover
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { rosetteRing } from "../src/lib/terrain";
import { cogNameFor, createWorldCover, dominantLabel } from "./sources/worldcover";
import { nodeIO, type BuildIO } from "./lib/buildIO";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Paths derived from the repo root, never named by the caller (CON-PROC-006). */
export function landCoverPathsFor(root: string): { treks: string } {
  const r = root.replace(/\/+$/, "");
  if (!r.startsWith("/") || r.split("/").includes("..")) {
    throw new Error(`refusing to build landcover: ${root} is not an absolute repo root`);
  }
  return { treks: `${r}/src/data/treks.json` };
}

/** The network, injected (spec 41 §A). */
export interface LandCoverDeps {
  classesAt: (pts: Array<{ lat: number; lng: number }>) => Promise<Array<number | undefined>>;
}

/**
 * A run may legitimately drop pins (detected summits standing in open water),
 * but losing a large share of the dataset means the SOURCE failed, not that
 * India changed. A transient header error once cached null for a whole 3° tile
 * and wiped landCover from ~113k records while reporting success — so the
 * fraction that may disappear in one run is bounded here (spec 41 §B.6).
 */
export const MAX_DROP_FRACTION = 0.05;

// Tight ring: 450 m (the DEM rosette) reaches the forested lower slopes and
// mislabels a bare summit; 150 m describes what the top of the climb is like.
const RING_M = 150;

export async function runBuildLandCover(
  io: BuildIO,
  root: string,
  deps: LandCoverDeps,
): Promise<{ baked: number; dropped: number; counts: Map<string, number> }> {
  const paths = landCoverPathsFor(root);
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];

  // Sample in spatial order (COG, then ~0.1° cell) so the tile cache's working
  // set stays tiny on a 119k-record nationwide run; write back by index so the
  // dataset keeps its original order.
  const order = treks
    .map((_, i) => i)
    .sort((a, b) => {
      const ka = `${cogNameFor(treks[a].lat, treks[a].lng)}:${Math.floor(treks[a].lat * 10)}:${Math.floor(treks[a].lng * 10)}`;
      const kb = `${cogNameFor(treks[b].lat, treks[b].lng)}:${Math.floor(treks[b].lat * 10)}:${Math.floor(treks[b].lng * 10)}`;
      return ka < kb ? -1 : ka > kb ? 1 : a - b;
    });
  let baked = 0;
  let dropped = 0;
  let done = 0;
  const next: (Trek | undefined)[] = new Array(treks.length);
  for (const i of order) {
    const t = treks[i];
    const pts = [{ lat: t.lat, lng: t.lng }, ...rosetteRing({ lat: t.lat, lng: t.lng }, RING_M)];
    const classes = await deps.classesAt(pts);
    const label = dominantLabel(classes.filter((c): c is number => c !== undefined));
    if (label === "Water" && t.detected) {
      // A terrain-DETECTED "summit" standing in open water is a corrupt DEM
      // sample by definition (spec 33) — drop the record, don't annotate it.
      dropped++;
    } else if (label) {
      next[i] = { ...t, landCover: label };
      baked++;
    } else {
      // No reading → drop any stale value rather than keep a wrong one.
      const copy = { ...t };
      delete copy.landCover;
      next[i] = copy;
    }
    done++;
    if (done % 5000 === 0) io.log(`[landcover]   ${done}/${treks.length} (${baked} covered)…`);
  }

  const kept = next.filter((t): t is Trek => t !== undefined);
  if (treks.length > 0 && dropped / treks.length > MAX_DROP_FRACTION) {
    throw new Error(
      `[landcover] refusing to write: would drop ${dropped}/${treks.length} records ` +
        `(> ${MAX_DROP_FRACTION * 100}%) — the source failed, India did not change`,
    );
  }
  const ds = validateDataset(kept);
  if (!ds.ok) throw new Error(`[landcover] dataset invalid: ${ds.error}`);

  // ---- Everything above can refuse. Everything below only writes. ----
  io.writeFile(paths.treks, JSON.stringify(ds.treks) + "\n");
  const counts = new Map<string, number>();
  for (const t of ds.treks) {
    if (t.landCover) counts.set(t.landCover, (counts.get(t.landCover) ?? 0) + 1);
  }
  if (dropped > 0) io.log(`[landcover] dropped ${dropped} detected pin(s) in open water.`);
  io.log(`[landcover] baked landCover onto ${baked}/${treks.length} treks:`);
  for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    io.log(`  ${label}: ${n}`);
  }
  return { baked, dropped, counts };
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wc = createWorldCover({ level: 2 });
  runBuildLandCover(nodeIO, repoRoot, { classesAt: (pts) => wc.classesAt(pts) }).catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

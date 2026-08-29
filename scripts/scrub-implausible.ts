/**
 * scrub-implausible — one-off cleanup (spec 33). Removes terrain-detected
 * records that fail the physical-plausibility gate (see isPlausibleSummit in
 * build-detect.ts) or whose sampled ground cover is open water, from BOTH the
 * baked dataset and the committed detection snapshot — pruning the snapshot is
 * what stops the weekly cron from resurrecting them.
 *
 *   npx tsx scripts/scrub-implausible.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { isPlausibleSummit, type DetectedSummit } from "./build-detect";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const detectedFile = resolve(here, "detected/india-detected.json");

/** True when a baked record should be scrubbed. Pure, tested. */
export function isImplausibleTrek(t: Trek): boolean {
  if (!t.detected) return false; // named sources are never auto-scrubbed
  if (t.landCover === "Water") return true;
  return !isPlausibleSummit({
    meanSlopeDeg: t.meanSlopeDeg ?? 0,
    reliefM: t.reliefM ?? 0,
    elevationM: t.elevationM ?? 0,
  });
}

async function main(): Promise<void> {
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const kept = treks.filter((t) => !isImplausibleTrek(t));
  const ds = validateDataset(kept);
  if (!ds.ok) throw new Error(`[scrub] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks) + "\n", "utf8");
  console.log(`[scrub] treks.json: ${treks.length} → ${ds.treks.length}`);

  const summits = JSON.parse(readFileSync(detectedFile, "utf8")) as DetectedSummit[];
  const keptSummits = summits.filter(isPlausibleSummit);
  writeFileSync(detectedFile, JSON.stringify(keptSummits) + "\n", "utf8");
  console.log(`[scrub] india-detected.json: ${summits.length} → ${keptSummits.length}`);
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a scrub, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

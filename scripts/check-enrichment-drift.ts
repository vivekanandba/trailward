/**
 * check-enrichment-drift — CI guard for the weekly data refresh (spec 31).
 * A rebake that "succeeds" can still silently strip enrichment (it happened:
 * a poisoned WorldCover header wiped landCover from thousands of records, and
 * validate:data was happy). This compares per-field counts in the working-tree
 * treks.json against the committed HEAD version and fails when any enrichment
 * field, or the record count, drops more than the tolerance.
 *
 *   npx tsx scripts/check-enrichment-drift.ts        # 2% default tolerance
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";

const FIELDS = [
  "name", // counted as non-"Unnamed" — a naming regression is a data loss too
  "bestSeason",
  "landCover",
  "historicalNote",
  "hillFeatures",
  "protectedArea",
  "heritage",
] as const;

const TOLERANCE = 0.02; // fraction each count may drop before this fails

export function fieldCounts(treks: Trek[]): Record<string, number> {
  const counts: Record<string, number> = { records: treks.length };
  for (const f of FIELDS) counts[f] = 0;
  for (const t of treks) {
    for (const f of FIELDS) {
      if (f === "name" ? !t.name.startsWith("Unnamed") : t[f] !== undefined) counts[f]++;
    }
  }
  return counts;
}

// Hand-curated fields have tiny counts (heritage: 2) where one record moving
// is a huge relative drop — a drop must also exceed this many records to fail.
const ABSOLUTE_FLOOR = 5;

/** Fields whose count dropped more than `tolerance` AND `floor` vs baseline. */
export function driftViolations(
  baseline: Record<string, number>,
  current: Record<string, number>,
  tolerance = TOLERANCE,
  floor = ABSOLUTE_FLOOR,
): string[] {
  const out: string[] = [];
  for (const [field, before] of Object.entries(baseline)) {
    const after = current[field] ?? 0;
    if (before > 0 && before - after > floor && after < before * (1 - tolerance)) {
      out.push(
        `${field}: ${before} → ${after} (−${(((before - after) / before) * 100).toFixed(1)}%)`,
      );
    }
  }
  return out;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const treksFile = resolve(here, "../src/data/treks.json");
  const current = fieldCounts(JSON.parse(readFileSync(treksFile, "utf8")) as Trek[]);
  const headJson = execFileSync("git", ["show", "HEAD:src/data/treks.json"], {
    cwd: here,
    maxBuffer: 1024 * 1024 * 256,
    encoding: "utf8",
  });
  const baseline = fieldCounts(JSON.parse(headJson) as Trek[]);

  for (const [field, n] of Object.entries(current)) {
    console.log(`[drift] ${field}: ${baseline[field]} → ${n}`);
  }
  const violations = driftViolations(baseline, current);
  if (violations.length > 0) {
    console.error(`[drift] enrichment dropped beyond ${TOLERANCE * 100}% tolerance:`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log("[drift] ok — no enrichment field regressed.");
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a check, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

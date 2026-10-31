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
import { photoCarries } from "./lib/carryover";

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

/**
 * Fields a weekly refresh never legitimately removes from a curated record:
 * the road distance and drive time (`run` fields, never carried stale, so a
 * route-service hiccup drops them outright) and the photo (carried unless the
 * seed's sources change, which happens in a reviewed PR, not in a refresh;
 * six were once lost to a source that changed shape). Spec 10.
 */
const CURATED_KEPT = ["distanceKm", "driveTimeMin", "image"] as const;

/**
 * One line per curated field that the committed record had and this one
 * lacks, compared per record and per field with no tolerance: there are only
 * 16, and a count would let one record's gain hide another's loss. A record
 * new to the file or to the curated tier, or a field it never had, is not a loss.
 */
export function curatedLosses(head: Trek[], now: Trek[]): string[] {
  const before = new Map(head.map((t) => [t.id, t]));
  const out: string[] = [];
  for (const t of now) {
    const prev = before.get(t.id);
    // Curated then and now: a pin promoted this run never had curated facts.
    if (t.tier !== "curated" || prev?.tier !== "curated") continue;
    // A photo the fold dropped on purpose (the seed moved, or cites other
    // sources) is the fold's own rule, not a loss.
    const kept = CURATED_KEPT.filter((f) => f !== "image" || photoCarries(prev, t));
    const lost = kept.filter((f) => prev[f] !== undefined && t[f] === undefined);
    if (lost.length > 0) out.push(`${t.id}: lost ${lost.join(" and ")}`);
  }
  return out;
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
  const now = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const current = fieldCounts(now);
  const headJson = execFileSync("git", ["show", "HEAD:src/data/treks.json"], {
    cwd: here,
    maxBuffer: 1024 * 1024 * 256,
    encoding: "utf8",
  });
  const head = JSON.parse(headJson) as Trek[];
  const baseline = fieldCounts(head);

  for (const [field, n] of Object.entries(current)) {
    console.log(`[drift] ${field}: ${baseline[field]} → ${n}`);
  }
  const violations = driftViolations(baseline, current);
  const lost = curatedLosses(head, now);
  console.log(`[drift] curated records that lost a kept field: ${lost.length}`);
  for (const l of lost) violations.push(`curated ${l}`);
  if (violations.length > 0) {
    console.error(`[drift] enrichment dropped:`);
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

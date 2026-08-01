/**
 * migrate-region-free — one-off migration (spec 30). Discovery pins used to be
 * duplicated per region (`gn-123--bengaluru` AND `gn-123--chikmagalur` for the
 * same hill) because the app filtered by city membership. Now that the app
 * filters by DISTANCE from any searched origin, each summit is one region-free
 * record: the `--region` suffix is dropped and duplicates are merged, keeping
 * every enrichment field any copy carried.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");

/** Strip the per-region suffix from a discovery id; curated ids pass through. */
export function regionFreeId(id: string): string {
  const m = /^((?:gn|d12|osm|manual)-.+?)--[a-z0-9-]+$/.exec(id);
  return m ? m[1] : id;
}

/**
 * Merge duplicate records of one summit: field-union, first-non-undefined wins
 * except that a "better" name (human/inferred, i.e. not "Unnamed…") always
 * beats a placeholder. Deterministic given input order.
 */
export function mergeDuplicates(records: Trek[]): Trek {
  const out: Record<string, unknown> = { ...records[0] };
  for (const r of records.slice(1)) {
    for (const [k, v] of Object.entries(r)) {
      if (out[k] === undefined && v !== undefined) out[k] = v;
    }
    if (
      typeof out.name === "string" &&
      out.name.startsWith("Unnamed") &&
      !r.name.startsWith("Unnamed")
    ) {
      out.name = r.name;
      if (r.highlights) out.highlights = r.highlights;
    }
  }
  // Discovery pins are nationwide now — city membership is meaningless.
  if (out.tier === "discovery") delete out.cityId;
  return out as unknown as Trek;
}

async function main(): Promise<void> {
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const groups = new Map<string, Trek[]>();
  for (const t of treks) {
    const id = regionFreeId(t.id);
    (groups.get(id) ?? groups.set(id, []).get(id)!).push(t);
  }
  const next: Trek[] = [];
  for (const [id, records] of groups) {
    const merged = mergeDuplicates(records);
    merged.id = id;
    next.push(merged);
  }
  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[migrate] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  console.log(`[migrate] ${treks.length} records → ${ds.treks.length} region-free.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

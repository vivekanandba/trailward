/**
 * build-hillfeatures — occasional build tool (NOT the weekly cron). Fills in
 * `hillFeatures` (fort / temple / cave / ruins within ~600 m of the summit) for
 * the treks most likely to be picked: every curated trek, everything that already
 * carries a trail or trailhead POIs, and the top-ranked discovery peaks per
 * region. One Overpass call each, throttled — so it's bounded and re-runnable.
 *
 * The weekly `build:discovery` also populates this for the peaks it fetches
 * trails for; this backfills the rest without a full rebuild.
 *   npm run build:hillfeatures
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { fetchOverpass } from "./sources/overpass";
import { parseHillFeatures } from "./sources/trails";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");

/** Top N discovery peaks per region, by hidden-gem score. */
const TOP_PER_REGION = 12;

/** Which treks are worth an Overpass call, most-valuable first. */
export function pickTargets(treks: Trek[], topPerRegion = TOP_PER_REGION): Trek[] {
  const chosen = new Map<string, Trek>();
  for (const t of treks) {
    if (t.tier === "curated" || t.trail || t.pois) chosen.set(t.id, t);
  }
  const byRegion = new Map<string, Trek[]>();
  for (const t of treks) {
    if (t.tier !== "discovery") continue;
    const list = byRegion.get(t.cityId) ?? [];
    list.push(t);
    byRegion.set(t.cityId, list);
  }
  for (const list of byRegion.values()) {
    list
      .sort((a, b) => (b.discoveryScore ?? 0) - (a.discoveryScore ?? 0))
      .slice(0, topPerRegion)
      .forEach((t) => chosen.set(t.id, t));
  }
  return [...chosen.values()];
}

async function featuresFor(t: Trek): Promise<Trek["hillFeatures"]> {
  const around = `${t.lat},${t.lng}`;
  const query =
    `[out:json][timeout:60];(` +
    `nwr(around:600,${around})[historic~"^(fort|castle|ruins|archaeological_site)$"];` +
    `nwr(around:600,${around})[amenity=place_of_worship];` +
    `nwr(around:600,${around})[natural=cave_entrance];` +
    `);out tags;`;
  try {
    const raw = await fetchOverpass(query);
    const f = parseHillFeatures(raw);
    return f.length > 0 ? f : undefined;
  } catch (err) {
    console.warn(`[hillfeatures] ${t.name}: ${(err as Error).message}`);
    return undefined;
  }
}

async function main(): Promise<void> {
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const targets = pickTargets(treks);
  console.log(`[hillfeatures] querying ${targets.length} summits…`);

  const found = new Map<string, NonNullable<Trek["hillFeatures"]>>();
  let done = 0;
  for (const t of targets) {
    const f = await featuresFor(t);
    if (f) found.set(t.id, f);
    if (++done % 10 === 0) {
      console.log(`[hillfeatures]   ${done}/${targets.length} (${found.size} with features)…`);
    }
  }
  console.log(`[hillfeatures] ${found.size}/${targets.length} summits carry mapped features.`);

  const next = treks.map((t) => {
    const f = found.get(t.id);
    if (f) return { ...t, hillFeatures: f };
    // Only clear a stale value for summits we actually re-queried this run.
    if (t.hillFeatures && targets.some((x) => x.id === t.id)) {
      const copy = { ...t };
      delete copy.hillFeatures;
      return copy;
    }
    return t;
  });

  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[hillfeatures] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  for (const t of ds.treks.filter((x) => x.hillFeatures).slice(0, 12)) {
    console.log(`  · ${t.name}: ${t.hillFeatures!.join(", ")}`);
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

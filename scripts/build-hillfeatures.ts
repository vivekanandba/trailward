/**
 * build-hillfeatures — occasional build tool (NOT the weekly cron). For the
 * treks most likely to be picked (every curated trek, everything already
 * carrying a trail/POIs, and the top-ranked discovery peaks per region) it
 * fills in, per summit:
 *  - `hillFeatures` — fort / temple / cave / ruins within ~600 m (spec 22), and
 *  - `protectedArea` — the sanctuary/national park enclosing it (spec 24),
 * from ONE combined Overpass call each, plus
 *  - `heritage` — a Wikidata P1435 designation (ASI monument etc.) within
 *    ~600 m, from one batched SPARQL box query per region (spec 24).
 *
 * The weekly `build:discovery` also populates hillFeatures for the peaks it
 * fetches trails for; this backfills the rest without a full rebuild.
 *   npm run build:hillfeatures
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { PRESET_ORIGINS } from "../src/lib/cities";
import { DEFAULT_ORIGIN } from "../src/lib/trek";
import { distanceFrom } from "../src/lib/distance";
import { fetchOverpass } from "./sources/overpass";
import { parseHillFeatures, parseProtectedArea } from "./sources/trails";
import { fetchHeritageSites, type HeritageSite } from "./sources/wikidata";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");

/** Top N discovery peaks per region, by hidden-gem score. */
const TOP_PER_REGION = 12;

/** A heritage site this close to the summit is "on" it. */
const HERITAGE_MATCH_KM = 0.6;

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

/** Nearest heritage designation within HERITAGE_MATCH_KM of the trek, if any. */
export function matchHeritage(t: Trek, sites: HeritageSite[]): string | undefined {
  let best: string | undefined;
  let bestKm = HERITAGE_MATCH_KM;
  for (const s of sites) {
    const km = distanceFrom({ id: "", name: "", lat: t.lat, lng: t.lng }, s);
    if (km <= bestKm) {
      bestKm = km;
      best = s.status;
    }
  }
  return best;
}

interface SummitInfo {
  hillFeatures?: Trek["hillFeatures"];
  protectedArea?: string;
}

async function infoFor(t: Trek): Promise<SummitInfo> {
  const around = `${t.lat},${t.lng}`;
  // Features near the summit AND the boundary polygons that contain it — one
  // request. The is_in areas come back as type:"area" elements, which
  // parseHillFeatures ignores and parseProtectedArea reads.
  const query =
    `[out:json][timeout:60];(` +
    `nwr(around:600,${around})[historic~"^(fort|castle|ruins|archaeological_site)$"];` +
    `nwr(around:600,${around})[amenity=place_of_worship];` +
    `nwr(around:600,${around})[natural=cave_entrance];` +
    `);out tags;` +
    `is_in(${around})->.a;(area.a[boundary=protected_area];area.a[leisure=nature_reserve];);out tags;`;
  try {
    const raw = await fetchOverpass(query);
    const f = parseHillFeatures(raw);
    return {
      ...(f.length > 0 ? { hillFeatures: f } : {}),
      ...(parseProtectedArea(raw) ? { protectedArea: parseProtectedArea(raw) } : {}),
    };
  } catch (err) {
    console.warn(`[hillfeatures] ${t.name}: ${(err as Error).message}`);
    return {};
  }
}

async function main(): Promise<void> {
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const targets = pickTargets(treks);
  console.log(`[hillfeatures] querying ${targets.length} summits…`);

  const found = new Map<string, SummitInfo>();
  let done = 0;
  for (const t of targets) {
    const info = await infoFor(t);
    if (info.hillFeatures || info.protectedArea) found.set(t.id, info);
    if (++done % 10 === 0) {
      console.log(`[hillfeatures]   ${done}/${targets.length} (${found.size} with data)…`);
    }
  }
  console.log(`[hillfeatures] ${found.size}/${targets.length} summits carry features/areas.`);

  // Heritage designations: one Wikidata box query per region, matched locally.
  const heritage = new Map<string, string>();
  for (const origin of PRESET_ORIGINS) {
    const radiusKm = origin.id === DEFAULT_ORIGIN.id ? 500 : 150;
    try {
      const sites = await fetchHeritageSites(origin, radiusKm);
      let n = 0;
      for (const t of targets) {
        if (t.cityId !== origin.id || heritage.has(t.id)) continue;
        const h = matchHeritage(t, sites);
        if (h) {
          heritage.set(t.id, h);
          n++;
        }
      }
      console.log(`[hillfeatures] ${origin.name}: ${sites.length} heritage sites, ${n} matched.`);
    } catch (err) {
      console.warn(`[hillfeatures] ${origin.name} heritage skipped: ${(err as Error).message}`);
    }
  }

  const queried = new Set(targets.map((t) => t.id));
  const next = treks.map((t) => {
    if (!queried.has(t.id)) return t;
    // Rebuild the summit's fields from this run — clearing stale values for
    // anything we re-queried, keeping everything we didn't touch.
    const copy = { ...t };
    delete copy.hillFeatures;
    delete copy.protectedArea;
    delete copy.heritage;
    const info = found.get(t.id);
    if (info?.hillFeatures) copy.hillFeatures = info.hillFeatures;
    if (info?.protectedArea) copy.protectedArea = info.protectedArea;
    const h = heritage.get(t.id);
    if (h) copy.heritage = h;
    return copy;
  });

  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[hillfeatures] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  const wf = ds.treks.filter((x) => x.hillFeatures).length;
  const wp = ds.treks.filter((x) => x.protectedArea).length;
  const wh = ds.treks.filter((x) => x.heritage).length;
  console.log(`[hillfeatures] baked: ${wf} features, ${wp} protected areas, ${wh} heritage.`);
  for (const t of ds.treks.filter((x) => x.protectedArea || x.heritage).slice(0, 10)) {
    console.log(`  · ${t.name}: ${t.protectedArea ?? ""}${t.heritage ? ` — ${t.heritage}` : ""}`);
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

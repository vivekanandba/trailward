/**
 * build-data — regenerates src/data/treks.json from the curated seed enriched
 * with free public sources (Overpass, Open-Meteo, OSRM, Wikipedia/Commons) and
 * ethical build-time scraping (spec 02).
 *
 * Design: `buildDataset` is the testable core — it takes the seed plus a set of
 * injectable enrichers, applies source precedence via `mergeTrek`, and gates
 * every record through `validateTrek`. The CLI shell at the bottom wires the
 * real (network) enrichers and writes the file. Enrichment is best-effort: a
 * source that errors is skipped for that field, never failing the whole run.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Origin, Trek } from "../src/lib/trek";
import { validateDataset, validateTrek } from "../src/lib/trek";
import { distanceFrom } from "../src/lib/distance";
import { nodeIO, type BuildIO } from "./lib/buildIO";
import { mergeTrek } from "./sources/merge";
import { BANGALORE_ORIGIN, BANGALORE_SEED } from "./seed/bangalore";
import { fetchElevations } from "./sources/elevation";
import { fetchRoute } from "./sources/route";
import { fetchWiki, titleFromWikiUrl, type WikiInfo } from "./sources/wiki";
import { scrapeDetails } from "./sources/scrape";

export interface Enrichers {
  /** DEM elevation (m) used only when the seed has none. */
  elevation?(seed: Trek): Promise<number | undefined>;
  /** Road distance + drive time from the origin. */
  route?(
    origin: Origin,
    seed: Trek,
  ): Promise<{ distanceKm: number; driveTimeMin: number } | undefined>;
  /** Wikipedia summary + Commons image. */
  wiki?(seed: Trek): Promise<WikiInfo | undefined>;
  /** Scraped difficulty/permit/fee from an allowlisted page. */
  scrape?(seed: Trek): Promise<Partial<Trek>>;
}

async function safe<T>(p: Promise<T> | undefined, label: string): Promise<T | undefined> {
  if (!p) return undefined;
  try {
    return await p;
  } catch (err) {
    console.warn(`[build-data] ${label} skipped: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Build a validated dataset from seeds. Parts are ordered highest-precedence
 * first (manual seed > wiki > scrape > route > elevation fallback); `mergeTrek`
 * resolves conflicts positionally. A record that fails validation after merge
 * fails the whole run (spec 02).
 */
export async function buildDataset(
  seeds: Trek[],
  origin: Origin,
  enrichers: Enrichers = {},
): Promise<Trek[]> {
  const treks: Trek[] = [];

  for (const seed of seeds) {
    const parts: Partial<Trek>[] = [seed]; // manual seed wins every conflict

    const wiki = await safe(enrichers.wiki?.(seed), `wiki(${seed.id})`);
    if (wiki) parts.push({ highlights: wiki.summary, image: wiki.image });

    const scraped = await safe(enrichers.scrape?.(seed), `scrape(${seed.id})`);
    if (scraped) parts.push(scraped);

    const route = await safe(enrichers.route?.(origin, seed), `route(${seed.id})`);
    if (route) parts.push({ distanceKm: route.distanceKm, driveTimeMin: route.driveTimeMin });

    const elevation = await safe(enrichers.elevation?.(seed), `elevation(${seed.id})`);
    if (elevation !== undefined) parts.push({ elevationM: elevation });

    const merged = mergeTrek(parts);
    const res = validateTrek(merged);
    if (!res.ok) {
      throw new Error(`[build-data] '${seed.id}' invalid after merge: ${res.error}`);
    }
    treks.push(res.trek);
  }

  const ds = validateDataset(treks);
  if (!ds.ok) throw new Error(`[build-data] dataset invalid: ${ds.error}`);
  return ds.treks;
}

/**
 * Who decides each field of a curated record on a refresh (spec 10). A
 * `Record` over every key of Trek, so a new field fails to compile until it is
 * classified here: a hand-kept list of names silently missed five.
 *
 * - `run`: this run alone decides — the seed, then this run's enrichers. A
 *   field removed from the seed is removed; one an enricher supplied before
 *   and not this time is dropped too, because a curator may have removed it.
 * - `place`: baked for the summit's location by another tool or an earlier
 *   run (terrain, land cover, gazetteer, road distance). Kept unless this run
 *   produced a value, and only while the seed still points at the same place.
 * - `sources`: the photo, taken from the article the seed cites. Kept only
 *   while the place AND the cited sources are unchanged.
 */
type Owner = "run" | "place" | "sources";
const OWNER: Record<keyof Trek, Owner> = {
  id: "run",
  name: "run",
  lat: "run",
  lng: "run",
  cityId: "run",
  tier: "run",
  sources: "run",
  verified: "run",
  detected: "run",
  elevationM: "run",
  difficulty: "run",
  type: "run",
  bestSeason: "run",
  permitRequired: "run",
  entryFee: "run",
  nightTrek: "run",
  highlights: "run",
  nearestTown: "run",
  trailLengthKm: "run",
  trailType: "run",
  durationHrs: "run",
  distanceKm: "place",
  driveTimeMin: "place",
  reliefM: "place",
  prominenceProxyM: "place",
  meanSlopeDeg: "place",
  terrainConfidence: "place",
  discoveryScore: "place",
  estimatedDifficulty: "place",
  trail: "place",
  pois: "place",
  gallery: "place",
  altNames: "place",
  landCover: "place",
  historicalNote: "place",
  protectedArea: "place",
  heritage: "place",
  hillFeatures: "place",
  image: "sources",
};

// A seed whose coordinates were corrected by more than this describes a
// different point, and nothing baked for the old one carries over.
const SAME_PLACE_KM = 0.12;

const sameSources = (a: Trek, b: Trek): boolean =>
  JSON.stringify([...a.sources].sort()) === JSON.stringify([...b.sources].sort());

/** `next`'s fields, in `prev`'s key order (then any new keys), so a refresh diffs cleanly. */
function inKeyOrderOf(prev: Trek, next: Record<string, unknown>): Trek {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(prev)) if (k in next) out[k] = next[k];
  for (const k of Object.keys(next)) if (!(k in out)) out[k] = next[k];
  return out as unknown as Trek;
}

/**
 * Fold freshly built curated records into the committed dataset (spec 10).
 * build-data owns only the curated tier; every other record is kept exactly,
 * because build:discovery reads this file as the previous dataset and preserves
 * enrichment from it. A curated record keeps `place` and `sources` fields this
 * run did not produce, under the conditions in OWNER. Curated records whose
 * seed is gone are dropped.
 */
export function foldCurated(built: Trek[], existing: Trek[]): Trek[] {
  const prevById = new Map(existing.filter((t) => t.tier === "curated").map((t) => [t.id, t]));
  const curated = built.map((t) => {
    const prev = prevById.get(t.id);
    if (!prev) return t;
    const fresh = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined));
    const samePlace = distanceFrom(prev, t) <= SAME_PLACE_KM;
    const keep = (k: string): boolean => {
      const owner = OWNER[k as keyof Trek];
      if (owner === "place") return samePlace;
      if (owner === "sources") return samePlace && sameSources(prev, t);
      return false; // "run", or a key Trek does not declare
    };
    const carried = Object.fromEntries(
      Object.entries(prev).filter(([k, v]) => !(k in fresh) && v !== undefined && keep(k)),
    );
    return inKeyOrderOf(prev, { ...fresh, ...carried });
  });
  return [...curated, ...existing.filter((t) => t.tier !== "curated")];
}

/**
 * The whole build:data run against a filesystem (spec 10), so the fold that
 * main() writes is tested, not only the fold function: the original bug lived
 * here, in a write that replaced the file instead of folding into it.
 */
export async function runBuildData(
  io: BuildIO,
  file: string,
  seeds: Trek[],
  origin: Origin,
  enrichers: Enrichers,
): Promise<{ curated: number; total: number }> {
  const treks = await buildDataset(seeds, origin, enrichers);
  const existing = io.exists(file) ? (JSON.parse(io.readFile(file)) as Trek[]) : [];
  const ds = validateDataset(foldCurated(treks, existing));
  if (!ds.ok) throw new Error(`[build-data] dataset invalid: ${ds.error}`);
  io.writeFile(file, JSON.stringify(ds.treks) + "\n");
  io.log(
    `[build-data] ${treks.length} curated treks folded into ${ds.treks.length} records → ${file}`,
  );
  return { curated: treks.length, total: ds.treks.length };
}

// ---- CLI shell: wire the real network enrichers and write the file. ---------

export function liveEnrichers(): Enrichers {
  return {
    // Only fall back to the DEM when the curated seed has no elevation.
    elevation: async (seed) => {
      if (seed.elevationM !== undefined) return undefined;
      const [m] = await fetchElevations([{ lat: seed.lat, lng: seed.lng }]);
      return m;
    },
    route: (origin, seed) => fetchRoute(origin, { lat: seed.lat, lng: seed.lng }),
    wiki: async (seed) => {
      const title = seed.sources.map(titleFromWikiUrl).find((t): t is string => Boolean(t));
      return title ? fetchWiki(title) : undefined;
    },
    // Scrape only allowlisted, non-Wikipedia source pages (none today, but the
    // seam is here for Forest-dept URLs added later).
    scrape: async (seed) => {
      const url = seed.sources.find((s) => !s.includes("wikipedia.org"));
      return url ? scrapeDetails(url) : {};
    },
  };
}

async function main(): Promise<void> {
  console.log(`[build-data] building from ${BANGALORE_SEED.length} curated seeds…`);
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "../src/data/treks.json");
  await runBuildData(nodeIO, file, BANGALORE_SEED, BANGALORE_ORIGIN, liveEnrichers());
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

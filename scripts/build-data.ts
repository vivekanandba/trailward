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
import { CARRYOVER_KM } from "./lib/carryover";
import { seasonFor, type MonthlyRain } from "../src/lib/climate";
import climateGrid from "../src/data/climate.json";
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
  /** Best season from the committed rainfall grid, for a seed that states none. */
  season?(seed: Trek): string | undefined;
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
  /** Filled with the ids whose article lookup answered, photo or not. */
  articleAnswered: Set<string> = new Set(),
): Promise<Trek[]> {
  const treks: Trek[] = [];

  for (const seed of seeds) {
    const parts: Partial<Trek>[] = [seed]; // manual seed wins every conflict

    const wiki = await safe(enrichers.wiki?.(seed), `wiki(${seed.id})`);
    // A disambiguation page is not an answer about this summit, so a photo
    // carried from the article it used to be is not contradicted by it.
    if (wiki && !wiki.disambiguation) {
      articleAnswered.add(seed.id);
      parts.push({ highlights: wiki.summary, image: wiki.image });
    }

    const scraped = await safe(enrichers.scrape?.(seed), `scrape(${seed.id})`);
    if (scraped) parts.push(scraped);

    const route = await safe(enrichers.route?.(origin, seed), `route(${seed.id})`);
    if (route) parts.push({ distanceKm: route.distanceKm, driveTimeMin: route.driveTimeMin });

    const elevation = await safe(enrichers.elevation?.(seed), `elevation(${seed.id})`);
    if (elevation !== undefined) parts.push({ elevationM: elevation });

    // Derived this run, as build:climate would, so bestSeason stays a `run`
    // field; the seed's own season wins by its precedence in `parts`.
    const season = enrichers.season?.(seed);
    if (season) parts.push({ bestSeason: season });

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
 * - `place`: baked for the summit's location by another tool (terrain, land
 *   cover, gazetteer, hill features). Kept unless this run produced a value,
 *   and only while the seed still points at the same place. Road distance is
 *   NOT here: it is a fact about the route from the origin, so it is `run`,
 *   and the drift guard refuses a refresh that lost it wholesale.
 * - `sources`: the photo, taken from the article the seed cites. Kept only
 *   while the place AND the cited sources are unchanged, and only when this
 *   run's lookup could not say: a failed fetch or a title that is now a
 *   disambiguation page is unknown, but an article that answered with no
 *   usable photo (removed, relicensed) has none (CON-DATA-002).
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
  permitRequired: "run",
  entryFee: "run",
  nightTrek: "run",
  highlights: "run",
  nearestTown: "run",
  trailLengthKm: "run",
  trailType: "run",
  durationHrs: "run",
  // Discovery-tier signals; a curated record has a curator's difficulty and
  // is not a "hidden gem", so a promoted pin's must not follow it.
  discoveryScore: "run",
  estimatedDifficulty: "run",
  // The seed's, else derived this run from the committed rainfall grid, so a
  // season the curator deleted is gone and a seed with none still gets one.
  bestSeason: "run",
  // Facts about the route from the origin, not about the summit: a stale one
  // must not outlive the run that could not measure it.
  distanceKm: "run",
  driveTimeMin: "run",
  reliefM: "place",
  prominenceProxyM: "place",
  meanSlopeDeg: "place",
  terrainConfidence: "place",
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

// The previous record is not validated yet: a missing `sources` must read as
// "different", not crash the fold before validation can name the record.
const sourcesOf = (t: Trek): string[] => (Array.isArray(t.sources) ? [...t.sources].sort() : []);
const sameSources = (a: Trek, b: Trek): boolean =>
  JSON.stringify(sourcesOf(a)) === JSON.stringify(sourcesOf(b));

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
export function foldCurated(
  built: Trek[],
  existing: Trek[],
  articleAnswered: ReadonlySet<string> = new Set(),
): Trek[] {
  // Every tier: a seed that promotes a discovery pin to curated takes over
  // that record (and what was baked for its place) rather than duplicating it.
  const prevById = new Map(existing.map((t) => [t.id, t]));
  const builtIds = new Set(built.map((t) => t.id));
  const curated = built.map((t) => {
    const prev = prevById.get(t.id);
    if (!prev) return t;
    const fresh = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined));
    // A seed whose coordinates moved further than discovery's rescan distance
    // (spec 27) describes a different point; nothing baked for the old one carries.
    const samePlace = distanceFrom(prev, t) <= CARRYOVER_KM;
    const keep = (k: string): boolean => {
      const owner = OWNER[k as keyof Trek];
      if (owner === "place") return samePlace;
      if (owner === "sources") {
        return samePlace && sameSources(prev, t) && !articleAnswered.has(t.id);
      }
      return false; // "run", or a key Trek does not declare
    };
    const carried = Object.fromEntries(
      Object.entries(prev).filter(([k, v]) => !(k in fresh) && v !== undefined && keep(k)),
    );
    return inKeyOrderOf(prev, { ...fresh, ...carried });
  });
  return [...curated, ...existing.filter((t) => t.tier !== "curated" && !builtIds.has(t.id))];
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
  // A malformed file must read as invalid, by name, not crash the fold, and
  // before minutes of rate-limited enrichment rather than after.
  const refuse = (why: string): never => {
    throw new Error(`[build-data] ${file} ${why} — refusing to fold into it`);
  };
  let parsed: unknown = [];
  if (io.exists(file)) {
    try {
      parsed = JSON.parse(io.readFile(file));
    } catch (err) {
      refuse(`is not valid JSON (${(err as Error).message})`);
    }
  }
  if (!Array.isArray(parsed)) refuse("is not an array of treks");
  const entries = parsed as unknown[];
  const bad = entries.findIndex(
    (t) => typeof t !== "object" || t === null || typeof (t as Trek).id !== "string",
  );
  if (bad >= 0) refuse(`has an entry at index ${bad} that is not a trek with an id`);
  const existing = entries as Trek[];
  const answered = new Set<string>();
  const treks = await buildDataset(seeds, origin, enrichers, answered);
  const ds = validateDataset(foldCurated(treks, existing, answered));
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
    season: (seed) => seasonFor(climateGrid as Record<string, MonthlyRain>, seed),
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

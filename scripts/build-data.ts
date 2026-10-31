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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Origin, Trek } from "../src/lib/trek";
import { validateDataset, validateTrek } from "../src/lib/trek";
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

// The fields the curated seed itself states. They are a human judgement and
// come from this run's seed only, so one removed from the seed is removed here.
// Every other field on a committed curated record is either an enricher's
// output (photo, road distance) or baked by another tool (terrain, land cover,
// gazetteer, hill features), and survives a run that did not produce it.
const SEED_FIELDS = new Set<string>([
  "id",
  "name",
  "lat",
  "lng",
  "cityId",
  "tier",
  "verified",
  "sources",
  "elevationM",
  "difficulty",
  "type",
  "bestSeason",
  "nightTrek",
  "highlights",
  "nearestTown",
  "entryFee",
]);

/**
 * Fold freshly built curated records into the committed dataset (spec 10).
 * build-data owns only the curated tier; every other record is kept as it was,
 * because build:discovery reads this file as the previous dataset and preserves
 * enrichment from it. A curated record keeps every non-seed field it had unless
 * this run produced a new value: a source that failed or changed shape this week
 * is not evidence the photo or road distance is gone. Curated records whose
 * seed is gone are dropped.
 */
export function foldCurated(built: Trek[], existing: Trek[]): Trek[] {
  const prevById = new Map(existing.filter((t) => t.tier === "curated").map((t) => [t.id, t]));
  const curated = built.map((t) => {
    const prev = prevById.get(t.id);
    if (!prev) return t;
    const carried = Object.fromEntries(Object.entries(prev).filter(([k]) => !SEED_FIELDS.has(k)));
    const fresh = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined));
    return { ...carried, ...fresh } as Trek;
  });
  return [...curated, ...existing.filter((t) => t.tier !== "curated")];
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
  const treks = await buildDataset(BANGALORE_SEED, BANGALORE_ORIGIN, liveEnrichers());

  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(here, "../src/data/treks.json");
  const existing = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Trek[]) : [];
  const ds = validateDataset(foldCurated(treks, existing));
  if (!ds.ok) throw new Error(`[build-data] dataset invalid: ${ds.error}`);
  writeFileSync(out, JSON.stringify(ds.treks) + "\n", "utf8");
  console.log(
    `[build-data] ${treks.length} curated treks folded into ${ds.treks.length} records → ${out}`,
  );
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

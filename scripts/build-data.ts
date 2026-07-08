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
import { writeFileSync } from "node:fs";
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

// ---- CLI shell: wire the real network enrichers and write the file. ---------

function liveEnrichers(): Enrichers {
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
  writeFileSync(out, JSON.stringify(treks, null, 2) + "\n", "utf8");
  console.log(`[build-data] wrote ${treks.length} validated treks → ${out}`);
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

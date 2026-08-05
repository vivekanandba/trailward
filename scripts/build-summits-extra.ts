/**
 * build-summits-extra — occasional build tool (NOT the weekly cron). Sweeps
 * the two named-summit sources our pipeline never covered nationwide (spec 31):
 *
 *  - OSM `natural=peak/hill` nodes with a name, fetched in 2° latitude bands
 *    (an all-India query times Overpass out);
 *  - Wikidata mountains in India (P31/P279* Q8502, P17 Q668) with coordinates,
 *    paged through the CC0 SPARQL endpoint.
 *
 * Both are masked to India (GeoNames density mask — the bands sweep the same
 * neighbours the DEM scan did), deduped, terrain-scored offline from cached
 * z12 tiles, and written to the committed scripts/extra/india-extra-summits.json
 * that discover-precompute merges as listed pins. Where one lands within 400 m
 * of a terrain-detected pin, the named pin replaces it at the next rebake —
 * an "Unnamed peak" gains its name.
 *
 *   npm run build:extra
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { rosetteRing, computeTerrain, estimateDifficulty } from "../src/lib/terrain";
import { scoreDiscovery } from "../src/lib/discoveryScore";
import { fetchJson } from "./sources/http";
import { fetchOverpass } from "./sources/overpass";
import { createDemTiles } from "./sources/demtiles";
import { parseOsmSummits, parseWikidataSummits, type ExtraSummit } from "./sources/extrasummits";
import { inIndia, loadIndiaMask } from "./build-detect";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "extra/india-extra-summits.json");
const demCacheDir = resolve(here, ".cache/demtiles12");

const INDIA = { latMin: 6, latMax: 36, lngMin: 68, lngMax: 97.5 };
const BAND_DEG = 2; // an all-India Overpass query times out; 2° bands don't
const ROSETTE_RADIUS_M = 450; // same geometry as every other scorer
const WDQS = "https://query.wikidata.org/sparql";
const WD_PAGE = 2000;

/**
 * Silent-cap guard (spec 31): a sweep that fetched materially less than the
 * source says exists must FAIL, not exit 0 — a pagination or parsing bug once
 * quietly returned page 1 of 3 as "all Wikidata mountains". Pure, tested.
 */
export function assertSweepComplete(got: number, expected: number, label: string): void {
  if (expected > 0 && got < expected * 0.95) {
    throw new Error(
      `[extra] ${label} sweep incomplete: fetched ${got} of ${expected} — refusing to write`,
    );
  }
}

/** Fetch one bbox of named peak/hill nodes; a box that keeps 504ing (the high
 *  Himalaya is dense) is split in half and each half retried, twice deep.
 *  Exported for tests; `fetchImpl` injects a fake Overpass. */
export async function fetchOsmBox(
  latMin: number,
  latMax: number,
  lngMin: number,
  lngMax: number,
  depth = 0,
  fetchImpl: typeof fetchOverpass = fetchOverpass,
): Promise<ExtraSummit[]> {
  const bbox = `(${latMin},${lngMin},${latMax},${lngMax})`;
  const query =
    `[out:json][timeout:120];` +
    `(node["natural"="peak"]["name"]${bbox};node["natural"="hill"]["name"]${bbox};);out;`;
  try {
    return parseOsmSummits(await fetchImpl(query));
  } catch (err) {
    if (depth >= 2) throw err;
    console.warn(`[extra] box ${bbox} failed (${(err as Error).message}); splitting.`);
    const midLng = (lngMin + lngMax) / 2;
    return [
      ...(await fetchOsmBox(latMin, latMax, lngMin, midLng, depth + 1, fetchImpl)),
      ...(await fetchOsmBox(latMin, latMax, midLng, lngMax, depth + 1, fetchImpl)),
    ];
  }
}

async function fetchOsmBands(): Promise<ExtraSummit[]> {
  const out: ExtraSummit[] = [];
  for (let lat = INDIA.latMin; lat < INDIA.latMax; lat += BAND_DEG) {
    const parsed = await fetchOsmBox(lat, lat + BAND_DEG, INDIA.lngMin, INDIA.lngMax);
    out.push(...parsed);
    console.log(`[extra] OSM band ${lat}–${lat + BAND_DEG}: ${parsed.length} named summits.`);
  }
  return out;
}

async function fetchWikidata(): Promise<ExtraSummit[]> {
  const wdFetch = (sparql: string): Promise<unknown> =>
    fetchJson(`${WDQS}?query=${encodeURIComponent(sparql)}`, {
      headers: { accept: "application/sparql-results+json" },
      throttleMs: 1_000, // WDQS asks for gentle pacing
      timeoutMs: 120_000,
    });

  // How many exist, so the paged sweep can prove it fetched them all.
  const countJson = (await wdFetch(
    `SELECT (COUNT(*) AS ?n) WHERE { ?m wdt:P31/wdt:P279* wd:Q8502 ; wdt:P17 wd:Q668 ; wdt:P625 ?c . }`,
  )) as { results?: { bindings?: { n?: { value?: string } }[] } };
  const expected = Number(countJson?.results?.bindings?.[0]?.n?.value ?? 0);
  // A broken count response would silently DISARM the completeness guard —
  // India verifiably has thousands of Wikidata mountains, so demand a real count.
  if (!Number.isFinite(expected) || expected <= 0) {
    throw new Error(`[extra] Wikidata count query returned no usable total (${expected})`);
  }

  const out: ExtraSummit[] = [];
  let rawTotal = 0;
  for (let offset = 0; ; offset += WD_PAGE) {
    const sparql =
      `SELECT ?item ?itemLabel ?coord ?ele WHERE {` +
      ` ?item wdt:P31/wdt:P279* wd:Q8502 ; wdt:P17 wd:Q668 ; wdt:P625 ?coord .` +
      ` OPTIONAL { ?item wdt:P2044 ?ele . }` +
      ` SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hi,kn,ta,te,ml,mr,bn". }` +
      ` } ORDER BY ?item LIMIT ${WD_PAGE} OFFSET ${offset}`;
    const json = await wdFetch(sparql);
    const page = parseWikidataSummits(json);
    out.push(...page);
    // Pagination must follow the RAW row count — the parser drops label-less
    // items, so a "thin" parsed page can still mean a full page of results.
    const raw = (json as { results?: { bindings?: unknown[] } })?.results?.bindings?.length ?? 0;
    rawTotal += raw;
    console.log(`[extra] Wikidata offset ${offset}: ${raw} rows, ${page.length} usable.`);
    if (raw < WD_PAGE) break;
  }
  // Items with several P625 values produce extra rows, so rawTotal can exceed
  // the item count — the guard only fires on a SHORTFALL (the pagination-bug
  // class that once shipped page 1 of 3 as "everything").
  assertSweepComplete(rawTotal, expected, "Wikidata");
  return out;
}

/** Dedupe extras against each other: first by id (a Wikidata item with two
 *  P625 coordinates arrives as two rows), then on a ~250 m grid (OSM beats
 *  Wikidata — surveyed positions over imported ones); pure, tested. */
export function dedupeExtras(summits: ExtraSummit[]): ExtraSummit[] {
  const cell = 0.0025;
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const out: ExtraSummit[] = [];
  for (const s of summits) {
    if (seenIds.has(s.fullId)) continue;
    seenIds.add(s.fullId);
    const bx = Math.floor(s.lat / cell);
    const by = Math.floor(s.lng / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        if (seen.has(`${bx + dx}:${by + dy}`)) hit = true;
      }
    }
    if (hit) continue;
    seen.add(`${bx}:${by}`);
    out.push(s);
  }
  return out;
}

/** Same offline tile-DEM scoring as build:geonames — extras rank alongside. */
async function scoreExtras(summits: ExtraSummit[]): Promise<void> {
  const dem = createDemTiles({ cacheDir: demCacheDir });
  for (let i = 0; i < summits.length; i++) {
    const s = summits[i];
    const pts = [{ lat: s.lat, lng: s.lng }, ...rosetteRing(s, ROSETTE_RADIUS_M)];
    const elevs = await dem.elevations(pts);
    const centerElev = elevs[0] ?? s.elevationM;
    if (centerElev === undefined) continue; // DEM miss → leave unscored
    const terrain = computeTerrain(centerElev, elevs.slice(1), ROSETTE_RADIUS_M);
    s.elevationM = Math.round(centerElev);
    s.reliefM = Math.round(terrain.reliefM);
    s.prominenceProxyM = Math.round(terrain.prominenceProxyM);
    s.meanSlopeDeg = Math.round(terrain.meanSlopeDeg * 10) / 10;
    s.terrainConfidence = Math.round(terrain.confidence * 100) / 100;
    // Not in GeoNames and (for wd-) often only in a regional Wikipedia —
    // treated as obscure; the terrain drives the score.
    const { score } = scoreDiscovery(
      {
        reliefM: terrain.reliefM,
        prominenceProxyM: terrain.prominenceProxyM,
        meanSlopeDeg: terrain.meanSlopeDeg,
        confidence: terrain.confidence,
      },
      {
        hasWikipediaTag: false,
        hasWikidataTag: s.fullId.startsWith("wd-"),
        nearbyAmenityCount: 0,
        wikiArticlesWithin1km: -1,
      },
    );
    s.discoveryScore = Math.round(score * 1000) / 1000;
    s.estimatedDifficulty = estimateDifficulty(terrain);
    if ((i + 1) % 1000 === 0) console.log(`[extra]   scored ${i + 1}/${summits.length}…`);
  }
}

async function main(): Promise<void> {
  const [osm, wd] = [await fetchOsmBands(), await fetchWikidata()];
  const mask = await loadIndiaMask();
  const inCountry = [...osm, ...wd].filter((s) => inIndia(s, mask));
  console.log(`[extra] ${osm.length} OSM + ${wd.length} Wikidata → ${inCountry.length} in India.`);
  const deduped = dedupeExtras(inCountry);
  await scoreExtras(deduped);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(deduped) + "\n", "utf8");
  const scored = deduped.filter((s) => s.discoveryScore !== undefined).length;
  console.log(`[extra] wrote ${deduped.length} extra summits (${scored} scored) → ${outFile}`);
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

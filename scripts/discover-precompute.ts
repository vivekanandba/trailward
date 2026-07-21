/**
 * discover-precompute — topography-aware discovery for the preset regions
 * (spec 11), incl. Bengaluru where ranked peaks supplement the curated treks.
 * For each region it pulls OSM peaks, samples a DEM rosette
 * around each, computes terrain + obscurity, scores/ranks, estimates a
 * difficulty, and emits discovery-tier Trek records baked into treks.json.
 *
 * Design mirrors build-data: `precomputeRegion` is the testable core (inject
 * fetchers, no network); the CLI shell wires the real sources and writes.
 * A region whose fetch fails is skipped — its prior records are left intact,
 * never silently emptied.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Origin, Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { rosetteRing, computeTerrain, estimateDifficulty, type LatLng } from "../src/lib/terrain";
import { scoreDiscovery } from "../src/lib/discoveryScore";
import { distanceFrom } from "../src/lib/distance";
import type { ParsedPeak } from "../src/lib/overpass";
import { PRESET_ORIGINS } from "../src/lib/cities";
import { fetchPeaks, fetchTourismPoints } from "./sources/overpass";
import { fetchElevations } from "./sources/elevation";
import { fetchGeoSearchCount } from "./sources/geosearch";

export interface DiscoverFetchers {
  peaks(origin: Origin, radiusKm: number): Promise<ParsedPeak[]>;
  /** Index-aligned elevations for the sample points (rosette grid). */
  elevations(points: LatLng[]): Promise<(number | undefined)[]>;
  /** Optional tourism POIs for the amenity-density obscurity signal. */
  tourismPoints?(origin: Origin, radiusKm: number): Promise<LatLng[]>;
  /** Optional Wikipedia article count near a point (-1 = unknown/neutral). */
  wikiArticles?(lat: number, lng: number, radiusM: number): Promise<number>;
}

export const DISCOVERY_RADIUS_KM = 150; // precompute at the max slider radius
const ROSETTE_RADIUS_M = 450;
const SAMPLES_PER_CANDIDATE = 9; // center + 8 ring
const MAX_CANDIDATES = 60; // DEM-sample this many (top by elevation)
const MAX_RESULTS = 40; // keep this many (top by score); no silent cap
const AMENITY_RADIUS_KM = 1;

const round = (x: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// A discovery peak this close to a curated trek is almost certainly the same
// summit; drop it so Bangalore's famous curated hills aren't duplicated as
// "unverified" pins on top of themselves.
const CURATED_DEDUP_KM = 0.7;

/** Drop discovery peaks that coincide with an already-curated trek. */
export function dedupeAgainstCurated(discovery: Trek[], curated: Trek[]): Trek[] {
  return discovery.filter((d) => !curated.some((c) => distanceFrom(c, d) <= CURATED_DEDUP_KM));
}

/**
 * Build ranked, scored discovery-tier treks for one region. Pure aside from the
 * injected fetchers, so it unit-tests with fakes. Throws only if a fetcher
 * throws (the caller decides whether to skip the region).
 */
export async function precomputeRegion(
  origin: Origin,
  radiusKm: number,
  fetchers: DiscoverFetchers,
): Promise<Trek[]> {
  const peaks = await fetchers.peaks(origin, radiusKm);
  if (peaks.length === 0) return [];

  const candidates = [...peaks]
    .sort((a, b) => (b.elevationM ?? -1) - (a.elevationM ?? -1))
    .slice(0, MAX_CANDIDATES);

  // One flat sample list: [c0, ring0×8, c1, ring1×8, …], sliced back per peak.
  const samplePoints: LatLng[] = [];
  for (const c of candidates) {
    samplePoints.push({ lat: c.lat, lng: c.lng });
    samplePoints.push(...rosetteRing({ lat: c.lat, lng: c.lng }, ROSETTE_RADIUS_M));
  }
  const elevs = await fetchers.elevations(samplePoints);
  // Terrain is sliced per candidate by index, so a short/long elevation response
  // would silently misalign every downstream peak. Refuse rather than commit
  // corrupt terrain — the caller skips the region and keeps its prior records.
  if (elevs.length !== samplePoints.length) {
    throw new Error(
      `elevation count ${elevs.length} ≠ ${samplePoints.length} sample points; refusing misaligned terrain`,
    );
  }
  const tourism = (await fetchers.tourismPoints?.(origin, radiusKm)) ?? [];
  const regionSlug = slug(origin.name);

  const results: Trek[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const base = i * SAMPLES_PER_CANDIDATE;
    const centerDem = elevs[base];
    const ring = elevs.slice(base + 1, base + SAMPLES_PER_CANDIDATE);

    // DEM center for terrain consistency; OSM `ele` as a fallback / for display.
    const centerElev = centerDem ?? c.elevationM;
    const terrain = computeTerrain(centerElev, ring, ROSETTE_RADIUS_M);
    // Prefer the authoritative OSM prominence tag when present, else the proxy.
    const prominenceProxyM = c.notability.osmProminenceM ?? terrain.prominenceProxyM;

    const nearbyAmenityCount = tourism.filter(
      (p) => distanceFrom({ id: "c", name: "c", lat: c.lat, lng: c.lng }, p) <= AMENITY_RADIUS_KM,
    ).length;
    const wikiArticlesWithin1km = fetchers.wikiArticles
      ? await fetchers.wikiArticles(c.lat, c.lng, 1000)
      : -1;

    const { score } = scoreDiscovery(
      {
        reliefM: terrain.reliefM,
        prominenceProxyM,
        meanSlopeDeg: terrain.meanSlopeDeg,
        confidence: terrain.confidence,
      },
      {
        hasWikipediaTag: c.notability.hasWikipediaTag,
        hasWikidataTag: c.notability.hasWikidataTag,
        nearbyAmenityCount,
        wikiArticlesWithin1km,
      },
    );

    const osmId = c.id.replace(/^osm-/, "");
    results.push({
      id: `${c.id}--${regionSlug}`,
      name: c.notability.nameEn ?? c.name,
      lat: c.lat,
      lng: c.lng,
      cityId: origin.id,
      tier: "discovery",
      elevationM: centerElev === undefined ? undefined : round(centerElev),
      reliefM: round(terrain.reliefM),
      prominenceProxyM: round(prominenceProxyM),
      meanSlopeDeg: round(terrain.meanSlopeDeg, 1),
      terrainConfidence: round(terrain.confidence, 2),
      discoveryScore: round(score, 3),
      estimatedDifficulty: estimateDifficulty(terrain),
      sources: [`https://www.openstreetmap.org/node/${osmId}`],
      verified: false,
    });
  }

  results.sort(
    (a, b) =>
      (b.discoveryScore ?? 0) - (a.discoveryScore ?? 0) ||
      (b.elevationM ?? 0) - (a.elevationM ?? 0),
  );
  if (results.length > MAX_RESULTS) {
    console.warn(
      `[discover] ${origin.name}: ${results.length} scored peaks; keeping top ${MAX_RESULTS} by score.`,
    );
    return results.slice(0, MAX_RESULTS);
  }
  return results;
}

// ---- CLI shell: wire the real network fetchers and rewrite treks.json. ------

function liveFetchers(): DiscoverFetchers {
  return {
    peaks: (origin, radiusKm) => fetchPeaks(origin, radiusKm),
    elevations: (points) => fetchElevations(points),
    // Tourism/amenity density is a nice-to-have obscurity signal, not essential:
    // a failure degrades to "no nearby amenities" rather than losing the region.
    tourismPoints: (origin, radiusKm) =>
      fetchTourismPoints(origin, radiusKm).catch((err) => {
        console.warn(
          `[discover] ${origin.name}: tourism lookup failed (${(err as Error).message})`,
        );
        return [];
      }),
    wikiArticles: (lat, lng, radiusM) => fetchGeoSearchCount(lat, lng, radiusM),
  };
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "../src/data/treks.json");
  const existing = JSON.parse(readFileSync(file, "utf8")) as Trek[];

  // Every preset region gets topography discovery — including Bengaluru, where
  // the ranked peaks SUPPLEMENT the curated treks (deduped against them).
  const regions = PRESET_ORIGINS;
  const fetchers = liveFetchers();
  const recomputed = new Map<string, Trek[]>();

  for (const origin of regions) {
    try {
      console.log(`[discover] ${origin.name}: discovering peaks within ${DISCOVERY_RADIUS_KM} km…`);
      const treks = await precomputeRegion(origin, DISCOVERY_RADIUS_KM, fetchers);
      // Don't duplicate curated treks as discovery pins (Bengaluru).
      const curatedHere = existing.filter((t) => t.tier === "curated" && t.cityId === origin.id);
      const deduped = dedupeAgainstCurated(treks, curatedHere);
      recomputed.set(origin.id, deduped);
      const note = curatedHere.length ? ` (supplementing ${curatedHere.length} curated)` : "";
      console.log(`[discover] ${origin.name}: ${deduped.length} ranked discovery peaks${note}.`);
    } catch (err) {
      console.warn(`[discover] ${origin.name} skipped: ${(err as Error).message}`);
    }
  }

  // Keep curated records and any discovery region we did NOT recompute; replace
  // the discovery set for every region we did.
  const kept = existing.filter((t) => t.tier === "curated" || !recomputed.has(t.cityId));
  const next = [...kept, ...[...recomputed.values()].flat()];

  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[discover] dataset invalid: ${ds.error}`);
  writeFileSync(file, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  const discoveryTotal = ds.treks.filter((t) => t.tier === "discovery").length;
  console.log(
    `[discover] wrote ${ds.treks.length} treks (${discoveryTotal} discovery total; ` +
      `${recomputed.size} region(s) recomputed this run) → ${file}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

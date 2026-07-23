/**
 * discover-precompute — topography-aware discovery for the preset regions
 * (spec 11), incl. Bengaluru where ranked peaks supplement the curated treks
 * and reach out to 500 km. For each region it pulls OSM peaks, samples a DEM
 * rosette around each, computes terrain + obscurity, scores/ranks, estimates a
 * difficulty, and enriches the top peaks with a Commons photo, a nearby-article
 * summary, and the nearest town. It also attaches terrain to the curated treks.
 *
 * Design mirrors build-data: `precomputeRegion` is the testable core (inject
 * fetchers, no network); the CLI shell wires the real sources and writes.
 * A region whose essential fetch fails is skipped — its prior records are left
 * intact, never silently emptied; enrichment is best-effort per peak.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Origin, Trek, TrekImage } from "../src/lib/trek";
import { DEFAULT_ORIGIN, validateDataset } from "../src/lib/trek";
import { rosetteRing, computeTerrain, estimateDifficulty, type LatLng } from "../src/lib/terrain";
import { scoreDiscovery } from "../src/lib/discoveryScore";
import { distanceFrom } from "../src/lib/distance";
import type { ParsedPeak } from "../src/lib/overpass";
import { PRESET_ORIGINS } from "../src/lib/cities";
import { fetchPeaks, fetchTourismPoints } from "./sources/overpass";
import { manualPeaksNear } from "./seed/manual-peaks";
import { fetchTrailAndPois } from "./sources/trails";
import { fetchElevations } from "./sources/elevation";
import { fetchNearestArticle } from "./sources/geosearch";
import { fetchWiki } from "./sources/wiki";
import { fetchNearbyPhotos } from "./sources/commons";
import { fetchNearestTown } from "./sources/reverse";

/** Enrichment for one peak — all optional, all best-effort. */
export interface PeakEnrichment {
  image?: TrekImage;
  gallery?: TrekImage[];
  highlights?: string;
  nearestTown?: string;
}

export interface DiscoverFetchers {
  peaks(origin: Origin, radiusKm: number): Promise<ParsedPeak[]>;
  /** Optional hand-added peaks absent from OSM (spec 12), merged as candidates. */
  manualPeaks?(origin: Origin, radiusKm: number): ParsedPeak[];
  /** Index-aligned elevations for the sample points (rosette grid). */
  elevations(points: LatLng[]): Promise<(number | undefined)[]>;
  /** Optional tourism POIs for the amenity-density obscurity signal. */
  tourismPoints?(origin: Origin, radiusKm: number): Promise<LatLng[]>;
  /** Optional photo/summary/town enrichment for the top-ranked peaks. */
  enrich?(peak: { lat: number; lng: number }): Promise<PeakEnrichment>;
  /** Optional nearest-trail + trailhead-POIs lookup for the very top peaks (spec 14/15). */
  trailAndPois?(peak: { lat: number; lng: number }): Promise<{
    trail?: Trek["trail"];
    pois?: Trek["pois"];
  }>;
}

// A manual peak this close to an OSM candidate is the same summit — drop the OSM
// duplicate so the manual entry (with its note/source) wins.
const MANUAL_DEDUP_KM = 0.2;

/** Merge manual peaks ahead of OSM peaks, dropping OSM peaks that duplicate one. */
export function mergeManualPeaks(manual: ParsedPeak[], osm: ParsedPeak[]): ParsedPeak[] {
  const deduped = osm.filter((o) => !manual.some((m) => distanceFrom(m, o) <= MANUAL_DEDUP_KM));
  return [...manual, ...deduped];
}

/** Per-region knobs (spec 11). We DEM-score every candidate (no elevation
 *  pre-filter) and KEEP THEM ALL — the UI filters (radius/difficulty/type/
 *  elevation) do the narrowing, not a server-side top-N. `maxCandidates` is only
 *  a high safety ceiling (warns if exceeded); `enrichLimit` bounds the expensive
 *  photo/summary/town enrichment to the top-ranked, since it's several throttled
 *  network calls per peak (the long tail still ships terrain + score). */
export interface RegionConfig {
  radiusKm: number;
  maxCandidates: number; // safety ceiling on DEM-scored candidates (warns if exceeded)
  enrichLimit: number; // enrich this many (top by score) with photo/summary/town
  trailLimit: number; // fetch a nearest trail for this many (top by score) — extra calls each
}

const ROSETTE_RADIUS_M = 450;
const SAMPLES_PER_CANDIDATE = 9; // center + 8 ring
const AMENITY_RADIUS_KM = 1;

export function configFor(origin: Origin): RegionConfig {
  return origin.id === DEFAULT_ORIGIN.id
    ? { radiusKm: 500, maxCandidates: 20000, enrichLimit: 150, trailLimit: 40 } // home: widest net
    : { radiusKm: 150, maxCandidates: 20000, enrichLimit: 60, trailLimit: 20 };
}

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

// Build the flat [center, ring×8] sample list for a set of points.
function rosetteSamples(points: { lat: number; lng: number }[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    out.push({ lat: p.lat, lng: p.lng });
    out.push(...rosetteRing({ lat: p.lat, lng: p.lng }, ROSETTE_RADIUS_M));
  }
  return out;
}

/**
 * Build ranked, scored, enriched discovery-tier treks for one region. Pure
 * aside from the injected fetchers, so it unit-tests with fakes. Throws only if
 * an essential fetcher throws (the caller decides whether to skip the region).
 */
export async function precomputeRegion(
  origin: Origin,
  fetchers: DiscoverFetchers,
  config: RegionConfig,
): Promise<Trek[]> {
  const osmPeaks = await fetchers.peaks(origin, config.radiusKm);
  const manual = fetchers.manualPeaks?.(origin, config.radiusKm) ?? [];
  const peaks = mergeManualPeaks(manual, osmPeaks);
  if (peaks.length === 0) return [];

  // Score EVERY candidate — no elevation pre-filter (that culled the low
  // Eastern-Ghats hills). Only a high safety ceiling bounds pathological cases.
  if (peaks.length > config.maxCandidates) {
    console.warn(
      `[discover] ${origin.name}: ${peaks.length} candidates exceed the ${config.maxCandidates} ceiling; scoring the first ${config.maxCandidates}.`,
    );
  }
  const candidates = peaks.slice(0, config.maxCandidates);

  const samplePoints = rosetteSamples(candidates);
  const elevs = await fetchers.elevations(samplePoints);
  // Terrain is sliced per candidate by index, so a short/long elevation response
  // would silently misalign every downstream peak. Refuse rather than commit
  // corrupt terrain — the caller skips the region and keeps its prior records.
  if (elevs.length !== samplePoints.length) {
    throw new Error(
      `elevation count ${elevs.length} ≠ ${samplePoints.length} sample points; refusing misaligned terrain`,
    );
  }
  const tourism = (await fetchers.tourismPoints?.(origin, config.radiusKm)) ?? [];
  const regionSlug = slug(origin.name);

  const results: Trek[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const base = i * SAMPLES_PER_CANDIDATE;
    const centerElev = elevs[base] ?? c.elevationM;
    const terrain = computeTerrain(
      centerElev,
      elevs.slice(base + 1, base + SAMPLES_PER_CANDIDATE),
      ROSETTE_RADIUS_M,
    );
    // Prefer the authoritative OSM prominence tag when present, else the proxy.
    const prominenceProxyM = c.notability.osmProminenceM ?? terrain.prominenceProxyM;

    const nearbyAmenityCount = tourism.filter(
      (p) => distanceFrom({ id: "c", name: "c", lat: c.lat, lng: c.lng }, p) <= AMENITY_RADIUS_KM,
    ).length;

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
        wikiArticlesWithin1km: -1, // scored from OSM tags + amenity density only
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
      // Manual peaks (spec 12) carry their own source + note; OSM peaks link the node.
      ...(c.note ? { highlights: c.note } : {}),
      sources: [c.sourceUrl ?? `https://www.openstreetmap.org/node/${osmId}`],
      verified: false,
    });
  }

  results.sort(
    (a, b) =>
      (b.discoveryScore ?? 0) - (a.discoveryScore ?? 0) ||
      (b.elevationM ?? 0) - (a.elevationM ?? 0),
  );

  // Keep every scored peak — the UI filters do the capping (user's call).
  // Enrich the top `enrichLimit` (photo / nearby-article summary / nearest town)
  // — several network calls per peak, so spent on the best-ranked; the long tail
  // ships terrain + score. Manual peaks (spec 12) are always enriched regardless
  // of rank, since they're hand-picked and few.
  if (fetchers.enrich) {
    const top = results.slice(0, config.enrichLimit);
    const manuals = results.filter((t) => t.id.startsWith("manual-") && !top.includes(t));
    for (const t of [...top, ...manuals]) {
      const e = await fetchers.enrich({ lat: t.lat, lng: t.lng });
      if (e.image) t.image = e.image;
      if (e.gallery && e.gallery.length > 0) t.gallery = e.gallery;
      // Don't let enrichment clobber a manual peak's own note.
      if (e.highlights && !t.id.startsWith("manual-")) t.highlights = e.highlights;
      if (e.nearestTown) t.nearestTown = e.nearestTown;
    }
  }

  // Attach a nearest OSM trail + trailhead POIs to the very top peaks + manual
  // peaks (spec 14/15) — one combined Overpass call each, so kept to trailLimit.
  if (fetchers.trailAndPois) {
    const topTrail = results.slice(0, config.trailLimit);
    const manualsT = results.filter((t) => t.id.startsWith("manual-") && !topTrail.includes(t));
    for (const t of [...topTrail, ...manualsT]) {
      const { trail, pois } = await fetchers.trailAndPois({ lat: t.lat, lng: t.lng });
      if (trail) t.trail = trail;
      if (pois && pois.length > 0) t.pois = pois;
    }
  }
  return results;
}

/**
 * Attach DEM terrain (relief/slope/prominence) to already-curated treks so the
 * known peaks are described in the same objective terms as the discovered ones.
 * Does NOT touch their difficulty/score — they keep their verified curation.
 * Best-effort: on any elevation failure the curated treks are returned unchanged.
 */
export async function enrichCuratedTerrain(
  curated: Trek[],
  elevations: DiscoverFetchers["elevations"],
): Promise<Trek[]> {
  if (curated.length === 0) return curated;
  const samplePoints = rosetteSamples(curated);
  const elevs = await elevations(samplePoints);
  if (elevs.length !== samplePoints.length) return curated;
  return curated.map((t, i) => {
    const base = i * SAMPLES_PER_CANDIDATE;
    const centerElev = elevs[base] ?? t.elevationM;
    const terrain = computeTerrain(
      centerElev,
      elevs.slice(base + 1, base + SAMPLES_PER_CANDIDATE),
      ROSETTE_RADIUS_M,
    );
    if (terrain.reliefM <= 0) return t; // DEM couldn't resolve it — leave as-is
    return {
      ...t,
      reliefM: round(terrain.reliefM),
      prominenceProxyM: round(terrain.prominenceProxyM),
      meanSlopeDeg: round(terrain.meanSlopeDeg, 1),
      terrainConfidence: round(terrain.confidence, 2),
    };
  });
}

// ---- CLI shell: wire the real network fetchers and rewrite treks.json. ------

function liveFetchers(): DiscoverFetchers {
  return {
    peaks: (origin, radiusKm) => fetchPeaks(origin, radiusKm),
    manualPeaks: (origin, radiusKm) => manualPeaksNear(origin, radiusKm),
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
    // A short summary only when an article sits *essentially on* the peak
    // (≤250 m) — a wider radius grabs a neighbouring named peak and mislabels
    // this one. A photo may come from that article or, failing that, a nearby
    // Commons file (area imagery, clearly credited). Plus the nearest town.
    // Every step is best-effort — a truly-unknown peak simply gets fewer.
    enrich: async ({ lat, lng }) => {
      const out: PeakEnrichment = {};
      const title = await fetchNearestArticle(lat, lng, 250);
      if (title) {
        const wiki = await fetchWiki(title).catch(
          () => ({}) as Awaited<ReturnType<typeof fetchWiki>>,
        );
        if (wiki.summary) out.highlights = wiki.summary;
        if (wiki.image) out.image = wiki.image;
      }
      // Up to 3 nearby Commons photos (gallery); the first also serves as the
      // hero when the article gave none.
      const photos = await fetchNearbyPhotos(lat, lng, 2000, 3);
      if (photos.length > 0) {
        out.gallery = photos;
        if (!out.image) out.image = photos[0];
      }
      const town = await fetchNearestTown(lat, lng);
      if (town) out.nearestTown = town;
      return out;
    },
    trailAndPois: (peak) => fetchTrailAndPois(peak, fetchElevations),
  };
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "../src/data/treks.json");
  const existing = JSON.parse(readFileSync(file, "utf8")) as Trek[];
  const fetchers = liveFetchers();

  // Attach terrain to the curated treks (Bengaluru) — best-effort.
  let enrichedCurated = existing.filter((t) => t.tier === "curated");
  try {
    enrichedCurated = await enrichCuratedTerrain(enrichedCurated, fetchers.elevations);
    console.log(`[discover] attached terrain to ${enrichedCurated.length} curated treks.`);
  } catch (err) {
    console.warn(`[discover] curated terrain skipped: ${(err as Error).message}`);
  }
  const curatedById = new Map(enrichedCurated.map((t) => [t.id, t]));

  const recomputed = new Map<string, Trek[]>();
  for (const origin of PRESET_ORIGINS) {
    const config = configFor(origin);
    try {
      console.log(`[discover] ${origin.name}: discovering peaks within ${config.radiusKm} km…`);
      const treks = await precomputeRegion(origin, fetchers, config);
      const curatedHere = existing.filter((t) => t.tier === "curated" && t.cityId === origin.id);
      const deduped = dedupeAgainstCurated(treks, curatedHere);
      // Never let an empty result (e.g. an Overpass timeout that returns no
      // elements rather than throwing) wipe a region's existing discovery peaks.
      const priorDiscovery = existing.filter(
        (t) => t.tier === "discovery" && t.cityId === origin.id,
      ).length;
      if (deduped.length === 0 && priorDiscovery > 0) {
        console.warn(
          `[discover] ${origin.name}: 0 peaks returned but ${priorDiscovery} exist — keeping prior.`,
        );
        continue;
      }
      recomputed.set(origin.id, deduped);
      const note = curatedHere.length ? ` (supplementing ${curatedHere.length} curated)` : "";
      console.log(`[discover] ${origin.name}: ${deduped.length} ranked discovery peaks${note}.`);
    } catch (err) {
      console.warn(`[discover] ${origin.name} skipped: ${(err as Error).message}`);
    }
  }

  // Keep curated (terrain-enriched) + any discovery region we did NOT recompute;
  // replace the discovery set for every region we did.
  const kept = existing
    .filter((t) => t.tier === "curated" || !recomputed.has(t.cityId))
    .map((t) => curatedById.get(t.id) ?? t);
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

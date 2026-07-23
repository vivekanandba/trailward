/**
 * build-geonames — occasional build tool (NOT the weekly cron). Downloads the
 * GeoNames India dump (CC-BY 4.0), filters to named summits (peaks/hills/
 * mountains/rocks) within reach of the preset regions, and writes a compact,
 * committed subset the discovery pipeline reads. The cron never re-downloads —
 * re-run this by hand to refresh:  npm run build:geonames
 */
import { execSync } from "node:child_process";
import { createReadStream, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { distanceFrom } from "../../src/lib/distance";
import { DEFAULT_ORIGIN } from "../../src/lib/trek";
import { PRESET_ORIGINS } from "../../src/lib/cities";
import { rosetteRing, computeTerrain, estimateDifficulty } from "../../src/lib/terrain";
import { scoreDiscovery, type ObscuritySignals } from "../../src/lib/discoveryScore";
import { createDemTiles } from "../sources/demtiles";
import { fetchWikidataKnown } from "../sources/wikidata";
import type { GeonamesSummit } from "../sources/geonames";

const SUMMIT_CODES = new Set(["PK", "PKS", "HLL", "HLLS", "MT", "MTS", "RK", "RKS"]);
const REACH_KM = 520; // a little over Bengaluru's 500 km, so nothing near an edge is lost
const ROSETTE_RADIUS_M = 450; // same rosette geometry the OSM discovery pipeline uses

const round = (x: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "india-summits.json");

function inReach(lat: number, lng: number): boolean {
  return PRESET_ORIGINS.some((o) => distanceFrom(o, { lat, lng }) <= REACH_KM);
}

async function main(): Promise<void> {
  const tmp = resolve(here, ".cache");
  mkdirSync(tmp, { recursive: true });
  const txt = resolve(tmp, "IN.txt");
  if (!existsSync(txt)) {
    console.log("[geonames] downloading IN.zip …");
    execSync(
      `curl -sSL -A "TrailwardBot/0.1 (trek data)" -o "${tmp}/IN.zip" https://download.geonames.org/export/dump/IN.zip`,
    );
    execSync(`unzip -o "${tmp}/IN.zip" IN.txt -d "${tmp}"`, { stdio: "ignore" });
  }

  const summits: GeonamesSummit[] = [];
  const rl = createInterface({ input: createReadStream(txt, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split("\t");
    if (c.length < 17 || c[6] !== "T" || !SUMMIT_CODES.has(c[7])) continue;
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (Number.isNaN(lat) || Number.isNaN(lng) || !inReach(lat, lng)) continue;
    const elevRaw = Number(c[15]) || Number(c[16]); // elevation, else SRTM dem
    const elevationM =
      Number.isFinite(elevRaw) && elevRaw > 0 && elevRaw <= 9000 ? Math.round(elevRaw) : undefined;
    summits.push({ id: c[0], name: c[1], lat, lng, elevationM });
  }
  console.log(`[geonames] filtered ${summits.length} summits; DEM-scoring via tiles…`);

  await scoreSummits(summits, resolve(tmp, "demtiles"));
  await crossMatchWikidata(summits);

  writeFileSync(OUT, JSON.stringify(summits) + "\n", "utf8");
  const scored = summits.filter((s) => s.discoveryScore !== undefined).length;
  console.log(`[geonames] wrote ${summits.length} summits (${scored} DEM-scored, CC-BY) → ${OUT}`);
}

const OBSCURE: ObscuritySignals = {
  hasWikipediaTag: false,
  hasWikidataTag: false,
  nearbyAmenityCount: 0,
  wikiArticlesWithin1km: -1,
};

// Discovery score from a summit's already-computed terrain + given notability.
function scoreWith(s: GeonamesSummit, obscurity: ObscuritySignals): number {
  const { score } = scoreDiscovery(
    {
      reliefM: s.reliefM!,
      prominenceProxyM: s.prominenceProxyM!,
      meanSlopeDeg: s.meanSlopeDeg!,
      confidence: s.terrainConfidence!,
    },
    obscurity,
  );
  return round(score, 3);
}

/**
 * Cross-match against Wikidata (spec 18). A summit that also exists in Wikidata
 * is "known", so re-score it as non-obscure (hasWikidataTag / hasWikipediaTag) —
 * this keeps the hidden-gem ranking honest, since GeoNames alone carries no
 * notability signal. Grabs a P18 photo when present (rare). One batched box
 * query per region; best-effort — a failed query just leaves that region as-is.
 */
async function crossMatchWikidata(summits: GeonamesSummit[]): Promise<void> {
  const byId = new Map(summits.map((s) => [s.id, s]));
  let matched = 0;
  let photos = 0;
  for (const origin of PRESET_ORIGINS) {
    const radiusKm = origin.id === DEFAULT_ORIGIN.id ? 500 : 150;
    let known;
    try {
      known = await fetchWikidataKnown(origin, radiusKm);
    } catch (err) {
      console.warn(
        `[geonames] ${origin.name}: Wikidata cross-match skipped (${(err as Error).message})`,
      );
      continue;
    }
    for (const [gnId, match] of known) {
      const s = byId.get(gnId);
      if (!s || s.reliefM === undefined) continue; // unmatched, or unscored (no terrain to rescore)
      s.discoveryScore = scoreWith(s, {
        ...OBSCURE,
        hasWikidataTag: true,
        hasWikipediaTag: match.hasArticle,
      });
      if (match.image && !s.image) {
        s.image = { url: match.image, attribution: "Wikimedia Commons (via Wikidata)" };
        photos++;
      }
      matched++;
    }
  }
  console.log(`[geonames] Wikidata: re-scored ${matched} known summits (${photos} photos).`);
}

/**
 * DEM-score each summit in place from Terrarium tiles (spec 17): sample the
 * 9-point rosette, compute relief/slope/prominence, and derive a discovery score
 * + estimated difficulty — the same maths the OSM pipeline runs, so GeoNames
 * pins rank alongside OSM peaks. GeoNames summits are, by definition, absent
 * from OSM, so they're treated as maximally obscure (no wiki/amenity signal);
 * the score is driven by topography. A summit the DEM can't resolve is left
 * unscored (name + elevation only). Tiles are cached on disk, so re-runs are fast.
 */
async function scoreSummits(summits: GeonamesSummit[], cacheDir: string): Promise<void> {
  const dem = createDemTiles({ cacheDir });
  for (let i = 0; i < summits.length; i++) {
    const s = summits[i];
    const pts = [
      { lat: s.lat, lng: s.lng },
      ...rosetteRing({ lat: s.lat, lng: s.lng }, ROSETTE_RADIUS_M),
    ];
    const elevs = await dem.elevations(pts);
    const centerElev = elevs[0] ?? s.elevationM;
    if (centerElev === undefined) continue; // DEM miss + no GeoNames elevation → leave unscored
    const terrain = computeTerrain(centerElev, elevs.slice(1), ROSETTE_RADIUS_M);
    s.elevationM = round(centerElev);
    s.reliefM = round(terrain.reliefM);
    s.prominenceProxyM = round(terrain.prominenceProxyM);
    s.meanSlopeDeg = round(terrain.meanSlopeDeg, 1);
    s.terrainConfidence = round(terrain.confidence, 2);
    // GeoNames summits are absent from OSM by definition → treated as maximally
    // obscure here; crossMatchWikidata later down-weights any that are "known".
    s.discoveryScore = scoreWith(s, OBSCURE);
    s.estimatedDifficulty = estimateDifficulty(terrain);
    if ((i + 1) % 500 === 0) console.log(`[geonames]   scored ${i + 1}/${summits.length}…`);
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});

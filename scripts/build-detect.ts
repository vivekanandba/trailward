/**
 * build-detect — occasional build tool (NOT the weekly cron). Scans the DEM
 * itself for summits no database names (spec 27): every z12 Terrarium tile
 * within each region's radius, local-maximum + relief detection, then offline
 * terrain scoring — all from tiles, zero API quota. Writes the committed
 * scripts/detected/india-detected.json the discovery pipeline merges.
 *
 *   npm run build:detect            # detect + score + write
 *   npm run build:detect -- --calibrate   # per-threshold counts only
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { type Trek } from "../src/lib/trek";
import { distanceFrom } from "../src/lib/distance";
import { rosetteRing, computeTerrain, estimateDifficulty } from "../src/lib/terrain";
import { scoreDiscovery } from "../src/lib/discoveryScore";
import {
  createTileGrid,
  detectPeaks,
  globalPixel,
  metresPerPixel,
  type DetectedPeak,
} from "./sources/peakdetect";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "detected/india-detected.json");
const treksFile = resolve(here, "../src/data/treks.json");
const cacheDir = resolve(here, ".cache/demtiles12");

const TILE = 256;
// A detected summit this close to ANY existing pin is that pin — the point of
// detection is what the databases missed, so be generous about "already known".
const KNOWN_DEDUP_KM = 0.4;
const MIN_RELIEF_M = 100; // hill threshold (below ~100 m z12-DEM relief is noisy); ≥150 m reads as a peak
const PEAK_RELIEF_M = 150;

export interface DetectedSummit {
  id: string; // d12-<tx>-<ty>-<px>-<py> — stable across runs
  name: string;
  lat: number;
  lng: number;
  elevationM: number;
  reliefM: number;
  prominenceProxyM: number;
  meanSlopeDeg: number;
  terrainConfidence: number;
  discoveryScore: number;
  estimatedDifficulty: Trek["estimatedDifficulty"];
  /** Provenance sentence when build-names inferred the name (spec 28). */
  inferredFrom?: string;
}

/**
 * Drop candidates the databases already know: anything within KNOWN_DEDUP_KM
 * of an existing pin. Grid-bucketed; pure, so the volume-defining dedupe is
 * testable without tiles or network.
 */
export function filterUnknown(
  peaks: DetectedPeak[],
  known: { lat: number; lng: number }[],
): DetectedPeak[] {
  const cell = 0.008; // ~900 m buckets
  const grid = new Map<string, { lat: number; lng: number }[]>();
  for (const k of known) {
    const key = `${Math.floor(k.lat / cell)}:${Math.floor(k.lng / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
  }
  const isKnown = (p: DetectedPeak): boolean => {
    const bx = Math.floor(p.lat / cell);
    const by = Math.floor(p.lng / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const c = grid.get(`${bx + dx}:${by + dy}`);
        if (c?.some((k) => distanceFrom({ id: "", name: "", ...k }, p) <= KNOWN_DEDUP_KM))
          return true;
      }
    }
    return false;
  };
  return peaks.filter((p) => !isKnown(p));
}

// India + Himalayan margins; includes some ocean, which scans as sea level.
const INDIA = { latMin: 6, latMax: 36, lngMin: 68, lngMax: 97.5 };

/**
 * The scan bbox unavoidably sweeps Nepal, Pakistan, Tibet, Bangladesh and
 * Myanmar — where our NAMED layers have no coverage, so famous peaks would
 * surface as "Unnamed" (Everest as an unnamed pin). Mask to India using the
 * GeoNames IN dump as a density mask: India is blanketed by ~660k features,
 * the neighbours by none. A summit within one ~9 km cell of any Indian
 * feature counts as in-India. Pure given the mask; tested.
 */
export const MASK_CELL_DEG = 0.08;

export function buildIndiaMask(featureCoords: Iterable<{ lat: number; lng: number }>): Set<string> {
  const mask = new Set<string>();
  for (const f of featureCoords) {
    mask.add(`${Math.floor(f.lat / MASK_CELL_DEG)}:${Math.floor(f.lng / MASK_CELL_DEG)}`);
  }
  return mask;
}

export function inIndia(p: { lat: number; lng: number }, mask: Set<string>): boolean {
  const bx = Math.floor(p.lat / MASK_CELL_DEG);
  const by = Math.floor(p.lng / MASK_CELL_DEG);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (mask.has(`${bx + dx}:${by + dy}`)) return true;
    }
  }
  return false;
}

async function loadIndiaMask(): Promise<Set<string>> {
  const { createReadStream, existsSync } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const dump = resolve(here, "geonames/.cache/IN.txt");
  if (!existsSync(dump)) {
    throw new Error(`India mask needs ${dump} — run \`npm run build:geonames\` first.`);
  }
  const coords: { lat: number; lng: number }[] = [];
  const rl = createInterface({ input: createReadStream(dump, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split("	");
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push({ lat, lng });
  }
  return buildIndiaMask(coords);
}

async function detectIndia(calibrate: boolean): Promise<DetectedPeak[]> {
  const midLat = 20;
  const mpp = metresPerPixel(midLat);
  const params = {
    minReliefM: calibrate ? 60 : MIN_RELIEF_M,
    nmsRadiusPx: Math.round(600 / mpp),
    reliefRadiusPx: Math.round(1000 / mpp),
    highland: {
      elevM: 2500,
      minReliefM: 300,
      nmsRadiusPx: Math.round(1500 / mpp),
    },
  };
  const nw = globalPixel(INDIA.latMax, INDIA.lngMin);
  const se = globalPixel(INDIA.latMin, INDIA.lngMax);
  const t0x = Math.floor(nw.gx / TILE);
  const t1x = Math.floor(se.gx / TILE);
  const t0y = Math.floor(nw.gy / TILE);
  const t1y = Math.floor(se.gy / TILE);
  const { grid, prefetch } = createTileGrid({ cacheDir, maxTiles: 4 * (t1x - t0x + 3) });
  const found: DetectedPeak[] = [];
  let scanned = 0;
  const total = (t1x - t0x + 1) * (t1y - t0y + 1);
  const prefetchRow = async (ty: number): Promise<void> => {
    if (ty < t0y - 1 || ty > t1y + 1) return;
    await Promise.all(
      Array.from({ length: t1x - t0x + 3 }, (_, i) => t0x - 1 + i).map((tx) => prefetch(tx, ty)),
    );
  };
  await prefetchRow(t0y - 1);
  await prefetchRow(t0y);
  for (let ty = t0y; ty <= t1y; ty++) {
    await prefetchRow(ty + 1);
    for (let tx = t0x; tx <= t1x; tx++) {
      scanned++;
      found.push(
        ...detectPeaks(
          grid,
          tx * TILE,
          ty * TILE,
          tx * TILE + TILE - 1,
          ty * TILE + TILE - 1,
          params,
        ),
      );
    }
    if (ty % 10 === 0) {
      console.log(`[detect]   ${scanned}/${total} tiles, ${found.length} candidates…`);
    }
  }
  return found;
}

/** Offline terrain scoring from the same z12 grid (no API calls). */
async function score(peaks: DetectedPeak[]): Promise<DetectedSummit[]> {
  const { grid, prefetch } = createTileGrid({ cacheDir });
  const out: DetectedSummit[] = [];
  for (const p of peaks) {
    const pts = [{ lat: p.lat, lng: p.lng }, ...rosetteRing({ lat: p.lat, lng: p.lng }, 450)];
    const elevs: (number | undefined)[] = [];
    for (const pt of pts) {
      const { gx, gy } = globalPixel(pt.lat, pt.lng);
      await prefetch(Math.floor(gx / TILE), Math.floor(gy / TILE));
      const e = grid.at(Math.floor(gx), Math.floor(gy));
      // Corrupt DEM pixels also appear as absurd NEGATIVE values (seen: −9,820 m
      // near Assam, which exploded "relief" to 9,861). Anything outside the
      // plausible band is a broken sample, not ground.
      elevs.push(Number.isNaN(e) || e < -430 || e > 9000 ? undefined : e);
    }
    const center = elevs[0] ?? p.elevationM;
    const terrain = computeTerrain(center, elevs.slice(1), 450);
    const { score: s } = scoreDiscovery(
      {
        reliefM: terrain.reliefM,
        prominenceProxyM: terrain.prominenceProxyM,
        meanSlopeDeg: terrain.meanSlopeDeg,
        confidence: terrain.confidence,
      },
      // Nothing lists these summits — maximally obscure by construction.
      {
        hasWikipediaTag: false,
        hasWikidataTag: false,
        nearbyAmenityCount: 0,
        wikiArticlesWithin1km: -1,
      },
    );
    const { gx, gy } = globalPixel(p.lat, p.lng);
    const kind = p.reliefM >= PEAK_RELIEF_M ? "peak" : "hill";
    out.push({
      id: `d12-${Math.floor(gx / TILE)}-${Math.floor(gy / TILE)}-${Math.floor(gx) % TILE}-${Math.floor(gy) % TILE}`,
      name: `Unnamed ${kind} (~${p.elevationM} m)`,
      lat: Math.round(p.lat * 1e5) / 1e5,
      lng: Math.round(p.lng * 1e5) / 1e5,
      elevationM: p.elevationM,
      reliefM: Math.round(terrain.reliefM),
      prominenceProxyM: Math.round(terrain.prominenceProxyM),
      meanSlopeDeg: Math.round(terrain.meanSlopeDeg * 10) / 10,
      terrainConfidence: Math.round(terrain.confidence * 100) / 100,
      discoveryScore: Math.round(s * 1000) / 1000,
      estimatedDifficulty: estimateDifficulty(terrain),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const calibrate = process.argv.includes("--calibrate");
  mkdirSync(dirname(outFile), { recursive: true });
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];

  // All-India scan (spec 30): one pass over the whole bbox with Himalaya
  // banding — above 2,500 m the relief floor rises to 300 m and NMS widens to
  // ~1.5 km, or every ridge crest in the high mountains becomes a "summit".
  const all = new Map<string, DetectedPeak>();
  {
    const peaks = await detectIndia(calibrate);
    for (const p of peaks) {
      const { gx, gy } = globalPixel(p.lat, p.lng);
      all.set(`${Math.floor(gx)}/${Math.floor(gy)}`, p);
    }
  }

  const mask = await loadIndiaMask();
  const inCountry = [...all.values()].filter((p) => inIndia(p, mask));
  console.log(`[detect] India mask: ${all.size} → ${inCountry.length} candidates.`);
  const fresh = filterUnknown(inCountry, treks);
  console.log(`[detect] ${all.size} distinct candidates → ${fresh.length} not in any database.`);

  if (calibrate) {
    for (const th of [60, 80, 100, 150, 200, 300]) {
      console.log(`  relief ≥ ${th} m: ${fresh.filter((p) => p.reliefM >= th).length}`);
    }
    return;
  }

  const scored = await score(fresh);
  writeFileSync(outFile, JSON.stringify(scored) + "\n", "utf8");
  const peaks = scored.filter((s) => s.name.includes("peak")).length;
  console.log(
    `[detect] wrote ${scored.length} detected summits (${peaks} peaks, ${scored.length - peaks} hills) → ${outFile}`,
  );
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

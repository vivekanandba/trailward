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
import { PRESET_ORIGINS } from "../src/lib/cities";
import { DEFAULT_ORIGIN, type Trek } from "../src/lib/trek";
import { distanceFrom } from "../src/lib/distance";
import { rosetteRing, computeTerrain, estimateDifficulty } from "../src/lib/terrain";
import { scoreDiscovery } from "../src/lib/discoveryScore";
import {
  createTileGrid,
  detectPeaks,
  globalPixel,
  metresPerPixel,
  DETECT_ZOOM,
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

async function detectRegion(
  origin: (typeof PRESET_ORIGINS)[number],
  radiusKm: number,
  calibrate: boolean,
): Promise<DetectedPeak[]> {
  const mpp = metresPerPixel(origin.lat);
  const params = {
    minReliefM: calibrate ? 60 : MIN_RELIEF_M,
    nmsRadiusPx: Math.round(600 / mpp),
    reliefRadiusPx: Math.round(1000 / mpp),
  };
  const { gx, gy } = globalPixel(origin.lat, origin.lng);
  const rPx = (radiusKm * 1000) / mpp;
  const t0x = Math.floor((gx - rPx) / TILE);
  const t1x = Math.floor((gx + rPx) / TILE);
  const t0y = Math.floor((gy - rPx) / TILE);
  const t1y = Math.floor((gy + rPx) / TILE);

  const { grid, prefetch } = createTileGrid({ cacheDir });
  const found: DetectedPeak[] = [];
  let scanned = 0;
  const total = (t1x - t0x + 1) * (t1y - t0y + 1);
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      scanned++;
      // Skip tiles whose centre is well outside the radius (with margin).
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      if (Math.hypot(cx - gx, cy - gy) > rPx + TILE) continue;
      // 3×3 neighbourhood so maxima/relief windows can cross tile edges.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          await prefetch(tx + dx, ty + dy);
        }
      }
      const peaks = detectPeaks(
        grid,
        tx * TILE,
        ty * TILE,
        tx * TILE + TILE - 1,
        ty * TILE + TILE - 1,
        params,
      );
      for (const p of peaks) {
        if (distanceFrom(origin, p) <= radiusKm) found.push(p);
      }
      if (scanned % 500 === 0) {
        console.log(
          `[detect]   ${origin.name}: ${scanned}/${total} tiles, ${found.length} candidates…`,
        );
      }
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
      elevs.push(Number.isNaN(e) ? undefined : e);
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

  const all = new Map<string, DetectedPeak>();
  for (const origin of PRESET_ORIGINS) {
    const radiusKm = origin.id === DEFAULT_ORIGIN.id ? 500 : 150;
    console.log(`[detect] ${origin.name}: scanning ${radiusKm} km at z${DETECT_ZOOM}…`);
    const peaks = await detectRegion(origin, radiusKm, calibrate);
    console.log(`[detect] ${origin.name}: ${peaks.length} raw candidates.`);
    for (const p of peaks) {
      const { gx, gy } = globalPixel(p.lat, p.lng);
      all.set(`${Math.floor(gx)}/${Math.floor(gy)}`, p); // overlap regions dedupe
    }
  }

  const fresh = filterUnknown([...all.values()], treks);
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

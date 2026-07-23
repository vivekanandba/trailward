/**
 * GeoNames listed summits (spec 16). Reads the committed, region-scoped subset
 * produced by scripts/geonames/build-geonames.ts (CC-BY 4.0) and serves the
 * ones near an origin. These are added to discovery as lightweight "listed"
 * pins — name + elevation only, no DEM scoring — so they cost nothing per peak.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Difficulty, Origin } from "../../src/lib/trek";
import { distanceFrom } from "../../src/lib/distance";

export interface GeonamesSummit {
  id: string;
  name: string;
  lat: number;
  lng: number;
  elevationM?: number;
  // Terrain rank baked by `build:geonames` (tile DEM, spec 17). Present when the
  // DEM resolved the summit; absent leaves the pin unscored (name + elevation).
  reliefM?: number;
  prominenceProxyM?: number;
  meanSlopeDeg?: number;
  terrainConfidence?: number;
  discoveryScore?: number;
  estimatedDifficulty?: Difficulty;
}

let cache: GeonamesSummit[] | null = null;

function all(): GeonamesSummit[] {
  if (!cache) {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, "../geonames/india-summits.json");
    try {
      cache = JSON.parse(readFileSync(file, "utf8")) as GeonamesSummit[];
    } catch {
      cache = []; // subset not built yet → no listed summits
    }
  }
  return cache;
}

/** GeoNames summits within radiusKm of the origin. */
export function geonamesSummitsNear(origin: Origin, radiusKm: number): GeonamesSummit[] {
  return all().filter((s) => distanceFrom(origin, s) <= radiusKm);
}

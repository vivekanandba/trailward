/**
 * Terrain-detected summits (spec 27). Reads the committed subset produced by
 * scripts/build-detect.ts — summits found by scanning the DEM itself, absent
 * from every name database — and serves the ones near an origin, mirroring
 * sources/geonames.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Origin } from "../../src/lib/trek";
import { distanceFrom } from "../../src/lib/distance";
import type { DetectedSummit } from "../build-detect";

let cache: DetectedSummit[] | null = null;

function all(): DetectedSummit[] {
  if (!cache) {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, "../detected/india-detected.json");
    try {
      cache = JSON.parse(readFileSync(file, "utf8")) as DetectedSummit[];
    } catch {
      cache = []; // subset not built yet → no detected summits
    }
  }
  return cache;
}

/** Detected summits within radiusKm of the origin. */
export function detectedSummitsNear(origin: Origin, radiusKm: number): DetectedSummit[] {
  return all().filter((s) => distanceFrom(origin, s) <= radiusKm);
}

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
import { isPlausibleSummit, type DetectedSummit } from "../build-detect";

let cache: DetectedSummit[] | null = null;
let humanCache: Record<string, { name: string; issue: number }> | null = null;

/** Community-supplied names (spec 29), keyed by summit id. */
export function humanNames(): Record<string, { name: string; issue: number }> {
  if (!humanCache) {
    const here = dirname(fileURLToPath(import.meta.url));
    try {
      humanCache = JSON.parse(
        readFileSync(resolve(here, "../detected/human-names.json"), "utf8"),
      ) as Record<string, { name: string; issue: number }>;
    } catch {
      humanCache = {};
    }
  }
  return humanCache;
}

function all(): DetectedSummit[] {
  if (!cache) {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, "../detected/india-detected.json");
    try {
      // Plausibility gate at LOAD (spec 33): even if the committed snapshot
      // carries corrupt records, the pipeline never bakes them again.
      cache = (JSON.parse(readFileSync(file, "utf8")) as DetectedSummit[]).filter(
        isPlausibleSummit,
      );
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

/** Every detected summit — the nationwide layer (spec 30). */
export function detectedSummitsAll(): DetectedSummit[] {
  return all();
}

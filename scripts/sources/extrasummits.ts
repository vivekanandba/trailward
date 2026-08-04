/**
 * Extra named summits beyond GeoNames (spec 31): OSM `natural=peak/hill`
 * nodes swept nationwide (the weekly cron only queries OSM around preset
 * cities, so most of India was never asked) and Wikidata mountains in India
 * (Indian-language Wikipedia articles produce Wikidata items GeoNames lacks).
 *
 * Both are free/no-key: Overpass (ODbL) and the Wikidata Query Service
 * (CC0). This module is the pure part — parsers and the committed-snapshot
 * reader; the fetch/score/write shell lives in scripts/build-summits-extra.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { GeonamesSummit } from "./geonames";

/** GeonamesSummit-shaped so `toListedTreks` consumes it unchanged, plus the
 *  full pin id and provenance link (which for gn- summits are derived). */
export interface ExtraSummit extends GeonamesSummit {
  fullId: string; // "osmx-<node>" | "wd-Q…" — never collides with osm-/gn-/d12-
  sourceUrl: string;
}

/** Parse an Overpass response of named peak/hill nodes. */
export function parseOsmSummits(json: unknown): ExtraSummit[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const out: ExtraSummit[] = [];
  for (const el of elements as {
    type?: string;
    id?: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
  }[]) {
    if (el?.type !== "node" || typeof el.id !== "number") continue;
    const name = el.tags?.name?.trim();
    const lat = Number(el.lat);
    const lng = Number(el.lon);
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const ele = Number(el.tags?.ele);
    out.push({
      id: String(el.id),
      fullId: `osmx-${el.id}`,
      name,
      lat,
      lng,
      // OSM `ele` is free-text; accept only a plausible metres value.
      ...(Number.isFinite(ele) && ele > -430 && ele < 9000 ? { elevationM: Math.round(ele) } : {}),
      sourceUrl: `https://www.openstreetmap.org/node/${el.id}`,
    });
  }
  return out;
}

/** Parse a Wikidata SPARQL result of mountains with coordinates. */
export function parseWikidataSummits(json: unknown): ExtraSummit[] {
  const bindings = (json as { results?: { bindings?: unknown } })?.results?.bindings;
  if (!Array.isArray(bindings)) return [];
  const out: ExtraSummit[] = [];
  for (const b of bindings as Record<string, { value?: string } | undefined>[]) {
    const uri = b.item?.value ?? "";
    const q = /Q\d+$/.exec(uri)?.[0];
    const name = b.itemLabel?.value?.trim();
    // "Point(lng lat)" — WKT order is lng first.
    const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(b.coord?.value ?? "");
    if (!q || !name || !m) continue;
    // A label that is just the Q-id means no human-readable name exists yet.
    if (/^Q\d+$/.test(name)) continue;
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const ele = Number(b.ele?.value);
    out.push({
      id: q,
      fullId: `wd-${q}`,
      name,
      lat,
      lng,
      ...(Number.isFinite(ele) && ele > -430 && ele < 9000 ? { elevationM: Math.round(ele) } : {}),
      sourceUrl: `https://www.wikidata.org/wiki/${q}`,
    });
  }
  return out;
}

let cache: ExtraSummit[] | null = null;

/** Every committed extra summit (nationwide) — mirrors geonamesSummitsAll(). */
export function extraSummitsAll(): ExtraSummit[] {
  if (!cache) {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, "../extra/india-extra-summits.json");
    try {
      cache = JSON.parse(readFileSync(file, "utf8")) as ExtraSummit[];
    } catch {
      cache = []; // snapshot not built yet → no extra summits
    }
  }
  return cache;
}

/**
 * Wikidata cross-match (spec 18). A GeoNames summit that also exists in Wikidata
 * is, by definition, "known" — so we down-weight its hidden-gem score to keep
 * that ranking honest (a famous rugged peak shouldn't read as a hidden gem just
 * because GeoNames carries no notability signal). One batched SPARQL box query
 * per region joins on the GeoNames ID (P1566); an occasional photo (P18) comes
 * along for free. Measured yield is small (~800 known, ~8 photos over Bengaluru's
 * radius) — this is a cheap honesty tweak, not a primary enrichment source.
 */
import type { Origin } from "../../src/lib/trek";
import { fetchText } from "./http";

export interface WikidataMatch {
  hasArticle: boolean; // an English Wikipedia article exists
  image?: string; // Commons FilePath URL (P18)
}

/** Pure: SPARQL JSON → GeoNames ID → match. Later rows win (dedupe on id). */
export function parseWikidataMatches(json: string): Map<string, WikidataMatch> {
  const out = new Map<string, WikidataMatch>();
  const parsed = JSON.parse(json) as {
    results?: { bindings?: Record<string, { value?: string }>[] };
  };
  for (const b of parsed.results?.bindings ?? []) {
    const id = b.geonames?.value;
    if (!id) continue;
    const prev = out.get(id);
    out.set(id, {
      hasArticle: prev?.hasArticle || Boolean(b.article?.value),
      image: b.image?.value ?? prev?.image,
    });
  }
  return out;
}

function bboxAround(origin: Origin, radiusKm: number): [number, number, number, number] {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((origin.lat * Math.PI) / 180));
  return [origin.lng - dLng, origin.lat - dLat, origin.lng + dLng, origin.lat + dLat];
}

function query(west: number, south: number, east: number, north: number): string {
  return `SELECT ?geonames ?image ?article WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerWest "Point(${west} ${south})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerEast "Point(${east} ${north})"^^geo:wktLiteral .
  }
  ?item wdt:P31/wdt:P279* wd:Q8502 .
  ?item wdt:P1566 ?geonames .
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
}`;
}

export interface HeritageSite {
  lat: number;
  lng: number;
  status: string; // e.g. "Monument of National Importance"
}

/** Pure: SPARQL JSON → heritage-designated sites with coordinates. */
export function parseHeritageSites(json: string): HeritageSite[] {
  const parsed = JSON.parse(json) as {
    results?: { bindings?: Record<string, { value?: string }>[] };
  };
  const out: HeritageSite[] = [];
  for (const b of parsed.results?.bindings ?? []) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? "");
    const status = b.statusLabel?.value;
    if (!m || !status) continue;
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng, status });
  }
  return out;
}

function heritageQuery(west: number, south: number, east: number, north: number): string {
  return `SELECT ?coord ?statusLabel WHERE {
  ?item wdt:P1435 ?status .
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerWest "Point(${west} ${south})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerEast "Point(${east} ${north})"^^geo:wktLiteral .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}`;
}

/**
 * Heritage-designated sites (Wikidata P1435 — ASI Monuments of National
 * Importance, State Protected Monuments, …) within the origin's radius
 * (spec 24). One box query per region.
 */
export async function fetchHeritageSites(
  origin: Origin,
  radiusKm: number,
): Promise<HeritageSite[]> {
  const [w, s, e, n] = bboxAround(origin, radiusKm);
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(heritageQuery(w, s, e, n))}`;
  const json = await fetchText(url, {
    headers: { accept: "application/sparql-results+json" },
    timeoutMs: 60_000,
  });
  return parseHeritageSites(json);
}

/** Wikidata mountains (with a GeoNames ID) within the origin's radius. */
export async function fetchWikidataKnown(
  origin: Origin,
  radiusKm: number,
): Promise<Map<string, WikidataMatch>> {
  const [w, s, e, n] = bboxAround(origin, radiusKm);
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query(w, s, e, n))}`;
  const json = await fetchText(url, {
    headers: { accept: "application/sparql-results+json" },
    timeoutMs: 60_000, // SPARQL box scans can be slow
  });
  return parseWikidataMatches(json);
}

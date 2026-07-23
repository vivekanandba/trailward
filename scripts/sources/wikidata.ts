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

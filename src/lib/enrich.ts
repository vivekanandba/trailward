/**
 * Lazy, client-side enrichment (spec 19). Most discovery pins — especially the
 * ~5,900 GeoNames summits — ship with only a name, coordinate, and terrain rank,
 * because baking a photo/summary/town for every one is far too much build work.
 * Instead we fetch those on demand, in the browser, the moment a user opens a
 * pin: a nearby Commons photo, a nearby-Wikipedia summary, and the nearest town.
 *
 * All three endpoints are CORS-enabled (Wikimedia via origin=*, Nominatim
 * ACAO:*), so no backend is needed. Every step is best-effort — a pin with
 * nothing nearby simply shows less. Parsers are pure/tested; the fetch shell is
 * exercised in the browser (and by a mocked-fetch component test).
 */
import type { TrekImage } from "./trek";

export interface WildSpecies {
  /** Preferred common name when iNaturalist has one, else the binomial. */
  name: string;
  /** Square thumbnail of the species' default photo (CC-licensed). */
  photo?: string;
  /** Photographer credit for the thumbnail. */
  attribution?: string;
}

export interface Wildlife {
  /** Research-grade observations near the peak. */
  records: number;
  /** A few distinct species actually recorded there. */
  species: WildSpecies[];
}

/** A nearby Wikivoyage travel article (spec 23) — sparse but high-quality. */
export interface Voyage {
  title: string;
  url: string;
  summary?: string;
}

export interface LiveEnrichment {
  image?: TrekImage;
  highlights?: string;
  nearestTown?: string;
  wildlife?: Wildlife;
  voyage?: Voyage;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Commons `generator=geosearch` + `imageinfo` → the nearest photo. */
export function parseCommonsPhoto(json: unknown): TrekImage | undefined {
  const pages = (json as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages) return undefined;
  for (const page of Object.values(pages)) {
    const info = (page as { imageinfo?: Record<string, unknown>[] }).imageinfo?.[0];
    if (!info) continue;
    const url = (info.thumburl as string) ?? (info.url as string);
    if (!url) continue;
    const meta = info.extmetadata as { Artist?: { value?: string } } | undefined;
    const artist = meta?.Artist?.value ? stripHtml(meta.Artist.value) : "";
    const descUrl = (info.descriptionurl as string) ?? "";
    const attribution = `${artist || "Wikimedia Commons"}${descUrl ? ` ${descUrl}` : ""}`.trim();
    return { url, attribution };
  }
  return undefined;
}

/** Wikipedia `list=geosearch` → the title of the nearest article. */
export function parseWikiTitle(json: unknown): string | undefined {
  const hit = (json as { query?: { geosearch?: { title?: string }[] } })?.query?.geosearch?.[0];
  return hit?.title || undefined;
}

/** Wikipedia REST summary → a short, non-disambiguation extract. */
export function parseWikiSummary(json: unknown): string | undefined {
  const d = json as { extract?: string; type?: string };
  if (!d?.extract || d.type === "disambiguation") return undefined;
  const text = d.extract.trim();
  return text.length > 400 ? text.slice(0, 397).trimEnd() + "…" : text;
}

/** Nominatim reverse geocode → the nearest populated place. */
export function parseNominatimTown(json: unknown): string | undefined {
  const a = (json as { address?: Record<string, string> })?.address;
  if (!a) return undefined;
  return (
    a.town || a.village || a.city || a.hamlet || a.suburb || a.municipality || a.county || undefined
  );
}

/**
 * iNaturalist observation search → record count + distinct species (spec 23).
 * iNaturalist beats GBIF for display: research-grade observations carry a
 * preferred COMMON name ("Indian Chameleon") and a CC-licensed default photo
 * with photographer attribution, so nothing has to be invented. Falls back to
 * the binomial when a species has no common name.
 */
export function parseWildlife(json: unknown, max = 6): Wildlife | undefined {
  const d = json as { total_results?: number; results?: Record<string, unknown>[] };
  if (typeof d?.total_results !== "number" || !Array.isArray(d.results)) return undefined;
  const species: WildSpecies[] = [];
  const seen = new Set<string>();
  for (const r of d.results) {
    const taxon = r.taxon as
      | {
          name?: string;
          preferred_common_name?: string;
          default_photo?: { square_url?: string; attribution?: string };
        }
      | undefined;
    const sci = taxon?.name;
    if (!sci || seen.has(sci)) continue;
    seen.add(sci);
    species.push({
      name: taxon?.preferred_common_name || sci,
      ...(taxon?.default_photo?.square_url ? { photo: taxon.default_photo.square_url } : {}),
      ...(taxon?.default_photo?.attribution
        ? { attribution: taxon.default_photo.attribution }
        : {}),
    });
    if (species.length >= max) break;
  }
  if (d.total_results === 0 && species.length === 0) return undefined;
  return { records: d.total_results, species };
}

/** Wikivoyage geosearch hit → a travel-article stub (title + canonical URL). */
export function parseVoyage(json: unknown): Voyage | undefined {
  const hit = (json as { query?: { geosearch?: { title?: string }[] } })?.query?.geosearch?.[0];
  if (!hit?.title) return undefined;
  return {
    title: hit.title,
    url: `https://en.wikivoyage.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
  };
}

type Fetcher = (url: string) => Promise<unknown>;

const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const coord = (lat: number, lng: number): string => `${lat}|${lng}`;

/**
 * Fetch a photo + summary + nearest town for a coordinate, live. Each source is
 * independent and best-effort, so one failing (or being empty) never blocks the
 * others. `getJson` is injectable for tests.
 */
export async function fetchLiveEnrichment(
  lat: number,
  lng: number,
  getJson: Fetcher = defaultFetch,
): Promise<LiveEnrichment> {
  const commonsUrl =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=geosearch&ggscoord=${coord(lat, lng)}&ggsradius=2000&ggslimit=5` +
    `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800`;
  const wikiGeoUrl =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&list=geosearch&gscoord=${coord(lat, lng)}&gsradius=250&gslimit=1`;
  const townUrl =
    `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&addressdetails=1` +
    `&lat=${lat}&lon=${lng}`;
  // Research-grade iNaturalist observations within ~5 km, most-voted first so
  // the species shown are the well-confirmed, charismatic ones.
  const wildlifeUrl =
    `https://api.inaturalist.org/v1/observations?quality_grade=research&per_page=30` +
    `&order_by=votes&iconic_taxa=Mammalia,Aves,Reptilia,Amphibia` +
    `&lat=${lat}&lng=${lng}&radius=5`;
  // Wikivoyage has articles only for notable destinations — one geosearch tells
  // us if this peak is (near) one, and the summary comes from its REST API.
  const voyageGeoUrl =
    `https://en.wikivoyage.org/w/api.php?action=query&format=json&origin=*` +
    `&list=geosearch&gscoord=${coord(lat, lng)}&gsradius=5000&gslimit=1`;

  const [image, highlights, nearestTown, wildlife, voyage] = await Promise.all([
    getJson(commonsUrl)
      .then(parseCommonsPhoto)
      .catch(() => undefined),
    getJson(wikiGeoUrl)
      .then(parseWikiTitle)
      .then((title) =>
        title
          ? getJson(
              `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
            )
          : undefined,
      )
      .then((s) => (s ? parseWikiSummary(s) : undefined))
      .catch(() => undefined),
    getJson(townUrl)
      .then(parseNominatimTown)
      .catch(() => undefined),
    getJson(wildlifeUrl)
      .then((j) => parseWildlife(j))
      .catch(() => undefined),
    getJson(voyageGeoUrl)
      .then(parseVoyage)
      .then(async (v) => {
        if (!v) return undefined;
        // Pull the article's first paragraph for a one-line practical summary.
        const s = await getJson(
          `https://en.wikivoyage.org/api/rest_v1/page/summary/${encodeURIComponent(v.title)}`,
        ).catch(() => undefined);
        const summary = s ? parseWikiSummary(s) : undefined;
        return summary ? { ...v, summary } : v;
      })
      .catch(() => undefined),
  ]);

  return { image, highlights, nearestTown, wildlife, voyage };
}

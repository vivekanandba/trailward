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

export interface LiveEnrichment {
  image?: TrekImage;
  highlights?: string;
  nearestTown?: string;
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

  const [image, highlights, nearestTown] = await Promise.all([
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
  ]);

  return { image, highlights, nearestTown };
}

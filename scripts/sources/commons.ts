/**
 * Wikimedia Commons nearby photo (spec 11 enrichment). Commons hosts only
 * freely-licensed media, so any geotagged file near a peak is safe to show with
 * attribution — the best free source of pictures for otherwise-undocumented
 * places. parse* are pure; fetchNearbyPhoto is the best-effort network wrapper.
 */
import type { TrekImage } from "../../src/lib/trek";
import { fetchJson } from "./http";

interface GeoSearchResponse {
  query?: { geosearch?: unknown };
}

/** Pure parser: Commons geosearch JSON → file titles ("File:…"), nearest first. */
export function parseCommonsFiles(json: unknown): string[] {
  const arr = (json as GeoSearchResponse)?.query?.geosearch;
  if (!Array.isArray(arr)) return [];
  return (arr as { title?: unknown }[])
    .map((r) => r.title)
    .filter((t): t is string => typeof t === "string" && t.startsWith("File:"));
}

interface ImageInfoResponse {
  query?: { pages?: Record<string, unknown> | unknown[] };
}

// Strip HTML tags/entities from a Commons "Artist"/attribution field.
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function imageFromPage(page: { imageinfo?: unknown[] }): TrekImage | undefined {
  const info = page?.imageinfo?.[0] as
    | {
        url?: unknown;
        thumburl?: unknown;
        descriptionurl?: unknown;
        extmetadata?: Record<string, { value?: unknown }>;
      }
    | undefined;
  const src = (typeof info?.thumburl === "string" && info.thumburl) || info?.url;
  if (typeof src !== "string") return undefined;
  const page_ = typeof info?.descriptionurl === "string" ? info.descriptionurl : undefined;
  const artistRaw = info?.extmetadata?.Artist?.value;
  const licenseRaw = info?.extmetadata?.LicenseShortName?.value;
  const artist = typeof artistRaw === "string" ? plainText(artistRaw) : "";
  const license = typeof licenseRaw === "string" ? plainText(licenseRaw) : "";
  const who = [artist, license].filter(Boolean).join(", ");
  const credit = `${who ? `${who} — ` : ""}Wikimedia Commons${page_ ? ` ${page_}` : ""}`;
  return { url: src, attribution: credit.trim() };
}

/** Pure parser: Commons imageinfo JSON → all TrekImages (one per page). */
export function parseCommonsImages(json: unknown): TrekImage[] {
  const pages = (json as ImageInfoResponse)?.query?.pages;
  const list = pages ? (Array.isArray(pages) ? pages : Object.values(pages)) : [];
  return (list as { imageinfo?: unknown[] }[])
    .map(imageFromPage)
    .filter((i): i is TrekImage => i !== undefined);
}

/** Pure parser: Commons imageinfo JSON → the first TrekImage, or undefined. */
export function parseCommonsImageInfo(json: unknown): TrekImage | undefined {
  return parseCommonsImages(json)[0];
}

/**
 * A CC-licensed Commons photo geotagged within `radiusM` of a point, or
 * undefined. Two calls: geosearch (nearest file), then imageinfo (url + credit).
 * Any failure or "no photo" returns undefined — never throws.
 */
/**
 * Up to `limit` nearby CC-licensed Commons photos (a gallery). Two calls:
 * geosearch (nearest files), then ONE multi-title imageinfo. Empty on failure.
 */
export async function fetchNearbyPhotos(
  lat: number,
  lng: number,
  radiusM = 3000,
  limit = 3,
): Promise<TrekImage[]> {
  try {
    const coord = encodeURIComponent(`${lat}|${lng}`);
    const geo =
      `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch` +
      `&gsnamespace=6&gscoord=${coord}&gsradius=${radiusM}&gslimit=${Math.max(limit, 5)}&format=json`;
    const titles = parseCommonsFiles(await fetchJson(geo)).slice(0, limit);
    if (titles.length === 0) return [];
    const info =
      `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo` +
      `&iiprop=url|extmetadata&iiurlwidth=800&titles=${encodeURIComponent(titles.join("|"))}&format=json`;
    return parseCommonsImages(await fetchJson(info));
  } catch {
    return [];
  }
}

/** A single nearby Commons photo (back-compat), or undefined. */
export async function fetchNearbyPhoto(
  lat: number,
  lng: number,
  radiusM = 3000,
): Promise<TrekImage | undefined> {
  return (await fetchNearbyPhotos(lat, lng, radiusM, 1))[0];
}

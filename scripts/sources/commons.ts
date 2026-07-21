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

/** Pure parser: Commons imageinfo JSON → a TrekImage with a credit, or undefined. */
export function parseCommonsImageInfo(json: unknown): TrekImage | undefined {
  const pages = (json as ImageInfoResponse)?.query?.pages;
  const list = pages ? (Array.isArray(pages) ? pages : Object.values(pages)) : [];
  for (const page of list as { imageinfo?: unknown[] }[]) {
    const info = page?.imageinfo?.[0] as
      | {
          url?: unknown;
          thumburl?: unknown;
          descriptionurl?: unknown;
          extmetadata?: Record<string, { value?: unknown }>;
        }
      | undefined;
    const src = (typeof info?.thumburl === "string" && info.thumburl) || info?.url;
    if (typeof src !== "string") continue;
    const page_ = typeof info?.descriptionurl === "string" ? info.descriptionurl : undefined;
    const artistRaw = info?.extmetadata?.Artist?.value;
    const licenseRaw = info?.extmetadata?.LicenseShortName?.value;
    const artist = typeof artistRaw === "string" ? plainText(artistRaw) : "";
    const license = typeof licenseRaw === "string" ? plainText(licenseRaw) : "";
    const who = [artist, license].filter(Boolean).join(", ");
    const credit = `${who ? `${who} — ` : ""}Wikimedia Commons${page_ ? ` ${page_}` : ""}`;
    return { url: src, attribution: credit.trim() };
  }
  return undefined;
}

/**
 * A CC-licensed Commons photo geotagged within `radiusM` of a point, or
 * undefined. Two calls: geosearch (nearest file), then imageinfo (url + credit).
 * Any failure or "no photo" returns undefined — never throws.
 */
export async function fetchNearbyPhoto(
  lat: number,
  lng: number,
  radiusM = 3000,
): Promise<TrekImage | undefined> {
  try {
    const coord = encodeURIComponent(`${lat}|${lng}`);
    const geo =
      `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch` +
      `&gsnamespace=6&gscoord=${coord}&gsradius=${radiusM}&gslimit=5&format=json`;
    const title = parseCommonsFiles(await fetchJson(geo))[0];
    if (!title) return undefined;
    const info =
      `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo` +
      `&iiprop=url|extmetadata&iiurlwidth=800&titles=${encodeURIComponent(title)}&format=json`;
    return parseCommonsImageInfo(await fetchJson(info));
  } catch {
    return undefined;
  }
}

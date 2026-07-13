/**
 * Wikipedia REST summary + a Wikimedia Commons image when one is available
 * (spec 02). parseWikiSummary is pure. Images are only taken from
 * upload.wikimedia.org (Commons) so we can attach a licensing attribution; if
 * the image lives elsewhere we skip it rather than guess a license.
 */
import type { TrekImage } from "../../src/lib/trek";
import { fetchJson } from "./http";

export interface WikiInfo {
  summary?: string;
  image?: TrekImage;
}

interface WikiSummaryResponse {
  extract?: unknown;
  originalimage?: { source?: unknown };
  thumbnail?: { source?: unknown };
  content_urls?: { desktop?: { page?: unknown } };
}

/**
 * Derive the Wikimedia Commons *file* page (where the license + author live)
 * from an upload.wikimedia.org URL, so the attribution links the licensing page
 * rather than the Wikipedia article. Handles both direct and /thumb/ URLs:
 *   .../commons/a/a8/Skandagiri.jpg                    → File:Skandagiri.jpg
 *   .../commons/thumb/a/a8/Skandagiri.jpg/330px-..jpg  → File:Skandagiri.jpg
 * Returns undefined if the URL isn't a recognisable Commons upload.
 */
export function commonsFilePage(uploadUrl: string): string | undefined {
  let path: string;
  try {
    path = new URL(uploadUrl).pathname;
  } catch {
    return undefined;
  }
  const segs = path.split("/").filter(Boolean);
  // The original filename is the last segment, or the second-to-last for thumbs.
  const file = segs.includes("thumb") ? segs[segs.length - 2] : segs[segs.length - 1];
  if (!file) return undefined;
  return `https://commons.wikimedia.org/wiki/File:${file}`;
}

function imageFrom(json: WikiSummaryResponse): TrekImage | undefined {
  const src = json.originalimage?.source ?? json.thumbnail?.source;
  if (typeof src !== "string" || !src.includes("upload.wikimedia.org")) return undefined;
  // Prefer the Commons file page (license/author); fall back to the article.
  const page = commonsFilePage(src) ?? (json.content_urls?.desktop?.page as string | undefined);
  const credit = typeof page === "string" ? `Wikimedia Commons — ${page}` : "Wikimedia Commons";
  return { url: src, attribution: credit };
}

/** Pure parser: Wikipedia summary JSON → { summary?, image? }. */
export function parseWikiSummary(json: unknown): WikiInfo {
  const data = (json ?? {}) as WikiSummaryResponse;
  const info: WikiInfo = {};
  if (typeof data.extract === "string" && data.extract.trim()) {
    info.summary = data.extract.trim();
  }
  const image = imageFrom(data);
  if (image) info.image = image;
  return info;
}

/** Fetch the Wikipedia summary for a page title. */
export async function fetchWiki(title: string): Promise<WikiInfo> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  return parseWikiSummary(await fetchJson(url));
}

/** Best-effort page title from a Wikipedia URL (…/wiki/Title). */
export function titleFromWikiUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.hostname !== "en.wikipedia.org") return undefined;
    const m = u.pathname.match(/\/wiki\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

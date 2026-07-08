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

function imageFrom(json: WikiSummaryResponse): TrekImage | undefined {
  const src = json.originalimage?.source ?? json.thumbnail?.source;
  const page = json.content_urls?.desktop?.page;
  if (typeof src !== "string" || !src.includes("upload.wikimedia.org")) return undefined;
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

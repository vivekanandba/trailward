/**
 * The 404 page's decisions (spec 44 R10), pure so they are tested. GitHub
 * Pages serves 404.html for every missing path under /trailward/.
 *
 * - A missing trek page (`/t/<slug>/`) stays here: the page says there is no
 *   page at that address and, when one slug in the sitemap is clearly closest,
 *   offers it. A tie or a weak match offers nothing; a guess is not an answer.
 * - Any other path goes into the app, keeping its query and hash, so a shared
 *   deep link written against an old path still opens its state.
 */
import { bestMatch } from "./lib/nearest";

const BASE = "/trailward/";

export type Route = { kind: "redirect"; to: string } | { kind: "trek"; slug: string };

export function routeFor(pathname: string, search: string, hash: string): Route {
  const m = pathname.match(/^\/trailward\/t\/([^/]+)\/?$/);
  if (m) return { kind: "trek", slug: decodeURIComponent(m[1]) };
  return { kind: "redirect", to: `${BASE}${search}${hash}` };
}

/** Every trek slug the sitemap advertises. */
export function slugsFromSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>[^<]*\/trailward\/t\/([^/<]+)\/<\/loc>/g)].map((m) => m[1]);
}

export function suggestionFor(slug: string, slugs: string[]): string | undefined {
  return bestMatch(slug, slugs);
}

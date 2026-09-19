/**
 * Absolute URLs and structured data (spec 35). ONE module owns every absolute
 * URL in the app; nothing else builds one by hand.
 *
 * The app is served from a project path (/trailward/), which is the most
 * common source of broken canonical/OG URLs on GitHub Pages: a helper that
 * naively joins SITE_URL + "/trailward/x" yields /trailward/trailward/x. That
 * bug shipped in the sibling portfolio project, so `absoluteUrl` strips a
 * leading base path and a regression test locks it.
 */
import type { Trek } from "./trek";

/** Site origin INCLUDING the base path, no trailing slash. */
export const SITE_URL = "https://vivekanandba.github.io/trailward";

/** The base path segment, derived from SITE_URL so the two can never disagree. */
const BASE_PATH = new URL(SITE_URL).pathname.replace(/\/$/, ""); // "/trailward"

/**
 * Absolute URL for a path, accepting it with OR without the base path — both
 * forms are common in calling code, and both must produce the same result.
 */
export function absoluteUrl(path: string): string {
  let p = path.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (BASE_PATH && (p === BASE_PATH || p.startsWith(`${BASE_PATH}/`))) {
    p = p.slice(BASE_PATH.length) || "/";
  }
  return `${SITE_URL}${p}`;
}

/** Canonical URL for a page. Directory routes keep their trailing slash. */
export function canonicalFor(path: string): string {
  return absoluteUrl(path);
}

/** Slash-joined, entity-safe XML text. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface SitemapEntry {
  /** Path relative to the site root, with or without the base path. */
  path: string;
  /** ISO date from the DATA, never from build time (spec 35). */
  lastmod?: string;
}

export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const loc = `    <loc>${xmlEscape(absoluteUrl(e.path))}</loc>`;
      const mod = e.lastmod ? `\n    <lastmod>${xmlEscape(e.lastmod)}</lastmod>` : "";
      return `  <url>\n${loc}${mod}\n  </url>`;
    })
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    "</urlset>\n"
  );
}

/** Licence of the aggregate dataset (the most restrictive of its inputs). */
export const DATA_LICENSE = "https://opendatacommons.org/licenses/odbl/1-0/";

/**
 * The app shell's graph: the product is both an application AND a dataset,
 * and `Dataset` is how a search engine understands the latter.
 */
export function appJsonLd(recordCount: number): unknown[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Trailward",
      url: absoluteUrl("/"),
      applicationCategory: "TravelApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
      description:
        "Interactive map of treks and summits within a chosen radius of any place in India.",
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Trailward summit dataset",
      url: absoluteUrl("/"),
      description:
        `${recordCount.toLocaleString("en-IN")} summits across India — named places from ` +
        "GeoNames, OpenStreetMap and Wikidata, plus peaks detected directly from elevation " +
        "tiles, each scored for terrain and enriched with season and ground cover.",
      license: DATA_LICENSE,
      creator: { "@type": "Person", name: "Vivekanand Balakrishnan" },
      spatialCoverage: { "@type": "Place", name: "India" },
      isAccessibleForFree: true,
    },
  ];
}

/**
 * A trek's Place graph. Only fields the record actually carries are emitted —
 * an absent elevation is omitted, never guessed (CON-DATA-001).
 */
export function trekJsonLd(trek: Trek): unknown {
  const geo: Record<string, unknown> = {
    "@type": "GeoCoordinates",
    latitude: trek.lat,
    longitude: trek.lng,
  };
  if (trek.elevationM !== undefined) geo.elevation = trek.elevationM;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TouristAttraction",
    name: trek.name,
    url: absoluteUrl(`t/${trek.id}/`),
    geo,
    isAccessibleForFree: true,
    address: { "@type": "PostalAddress", addressCountry: "IN" },
  };
  const description = trek.highlights ?? trek.historicalNote?.text;
  if (description) ld.description = description;
  if (trek.image?.url) ld.photo = trek.image.url;
  if (trek.nearestTown) {
    (ld.address as Record<string, unknown>).addressLocality = trek.nearestTown;
  }
  return ld;
}

import { describe, it, expect } from "vitest";
import { SITE_URL, absoluteUrl, canonicalFor, appJsonLd, trekJsonLd, sitemapXml } from "./seo";
import type { Trek } from "./trek";

const trek: Trek = {
  id: "skandagiri",
  name: "Skandagiri",
  lat: 13.5021,
  lng: 77.6911,
  tier: "curated",
  elevationM: 1350,
  difficulty: "Moderate",
  sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
  verified: true,
};

describe("absoluteUrl (spec 35 — the base path must never double)", () => {
  it("joins a bare path onto the site URL", () => {
    expect(absoluteUrl("t/skandagiri/")).toBe(`${SITE_URL}/t/skandagiri/`);
    expect(absoluteUrl("/t/skandagiri/")).toBe(`${SITE_URL}/t/skandagiri/`);
  });

  it("does NOT double the base path when the path already carries it", () => {
    // The exact bug that shipped in the sibling portfolio project.
    expect(absoluteUrl("/trailward/t/x/")).toBe(`${SITE_URL}/t/x/`);
    expect(absoluteUrl("/trailward/t/x/")).not.toContain("/trailward/trailward/");
  });

  it("returns the site root for an empty path", () => {
    expect(absoluteUrl("")).toBe(`${SITE_URL}/`);
    expect(absoluteUrl("/")).toBe(`${SITE_URL}/`);
  });

  it("preserves query strings and fragments", () => {
    expect(absoluteUrl("?sel=skandagiri")).toBe(`${SITE_URL}/?sel=skandagiri`);
  });

  it("SITE_URL is absolute, https, and carries no trailing slash", () => {
    expect(SITE_URL).toMatch(/^https:\/\//);
    expect(SITE_URL.endsWith("/")).toBe(false);
  });
});

describe("canonicalFor", () => {
  it("agrees with the og:url for the same page", () => {
    const c = canonicalFor("t/skandagiri/");
    expect(c).toBe(absoluteUrl("t/skandagiri/"));
    expect(c).toMatch(/\/$/); // directory routes stay trailing-slashed
  });
});

describe("trekJsonLd (spec 35 — never fabricate a field)", () => {
  it("emits geo coordinates and the elevation the record carries", () => {
    const ld = trekJsonLd(trek) as Record<string, never>;
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("TouristAttraction");
    expect(ld.name).toBe("Skandagiri");
    const geo = ld.geo as unknown as Record<string, unknown>;
    expect(geo.latitude).toBe(13.5021);
    expect(geo.longitude).toBe(77.6911);
    expect(geo.elevation).toBe(1350);
    expect(ld.url).toBe(absoluteUrl("t/skandagiri/"));
  });

  it("omits absent fields entirely rather than guessing (CON-DATA-001)", () => {
    const bare: Trek = { ...trek, elevationM: undefined, image: undefined };
    const ld = trekJsonLd(bare) as unknown as Record<string, unknown>;
    const geo = ld.geo as Record<string, unknown>;
    expect("elevation" in geo).toBe(false);
    expect("photo" in ld).toBe(false);
    // Serialising must not introduce nulls either.
    expect(JSON.stringify(ld)).not.toContain("null");
  });
});

describe("appJsonLd", () => {
  it("describes the app AND the dataset, with a licence", () => {
    const graph = appJsonLd(120441) as unknown as Record<string, unknown>[];
    const types = graph.map((n) => n["@type"]);
    expect(types).toContain("WebApplication");
    expect(types).toContain("Dataset");
    const dataset = graph.find((n) => n["@type"] === "Dataset")!;
    expect(String(dataset.license)).toMatch(/^https:\/\//);
    // Deliberate: en-IN lakh grouping ("1,20,441"), because the audience is
    // Indian trekkers — and an EXPLICIT locale, because a bare
    // toLocaleString() would vary by build machine in a committed artifact.
    expect(JSON.stringify(dataset)).toContain("1,20,441");
  });
});

describe("sitemapXml", () => {
  it("emits valid absolute-URL entries and escapes entities", () => {
    const xml = sitemapXml([{ path: "", lastmod: "2026-09-19" }, { path: "t/a&b/" }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(xml).toContain("<lastmod>2026-09-19</lastmod>");
    expect(xml).toContain("t/a&amp;b/"); // raw & would be invalid XML
    expect(xml).not.toMatch(/<loc>(?!https:\/\/)/);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});

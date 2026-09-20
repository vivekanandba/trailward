import { describe, it, expect } from "vitest";
import { renderContentPage, datasetStats, dataPageMarkdown } from "./contentPage";

const fm = { title: "Data sources", description: "Where every fact comes from." };

describe("renderContentPage (spec 36/40)", () => {
  const html = renderContentPage(fm, "<h1>Data sources</h1><p>Body.</p>", "sources");

  it("renders a complete document with the body inlined", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<h1>Data sources</h1>");
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
  });

  it("carries an absolute canonical that matches og:url", () => {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)![1];
    const og = /<meta property="og:url" content="([^"]+)"/.exec(html)![1];
    expect(canonical).toBe("https://vivekanandba.github.io/trailward/sources/");
    expect(og).toBe(canonical);
    expect(canonical).not.toContain("/trailward/trailward/");
  });

  it("escapes frontmatter — a title is not markup", () => {
    const evil = renderContentPage(
      { title: 'X <img src=x onerror="alert(1)">', description: "d" },
      "<p>b</p>",
      "x",
    );
    expect(evil).not.toContain("<img src=x");
    expect(evil).toContain("&lt;img");
  });

  it("shows the updated date only when the frontmatter carries one", () => {
    expect(renderContentPage({ ...fm, updated: "2026-09-19" }, "<p>b</p>", "s")).toContain(
      "Updated 2026-09-19",
    );
    expect(renderContentPage(fm, "<p>b</p>", "s")).not.toContain("Updated");
  });

  it("links the other content pages so they are reachable from each other", () => {
    const withNav = renderContentPage(fm, "<p>b</p>", "sources", ["about", "sources", "data"]);
    for (const href of [
      "/trailward/",
      "/trailward/about/",
      "/trailward/sources/",
      "/trailward/data/",
    ]) {
      expect(withNav).toContain(`href="${href}"`);
    }
  });

  it("DERIVES the nav from the slugs it is given, never a hardcoded list", () => {
    // A hardcoded footer was the third copy of the content list: deleting
    // content/about.md left every page linking to a URL that now 404s, and
    // adding content/faq.md shipped a page nothing on the site linked to.
    // check-links only probes https:// URLs, so neither would be caught.
    const renamed = renderContentPage(fm, "<p>b</p>", "x", ["faq", "data"]);
    expect(renamed).toContain('href="/trailward/faq/"');
    expect(renamed).toContain(">Faq<");
    expect(renamed).not.toContain('href="/trailward/about/"');
    expect(renamed).not.toContain('href="/trailward/sources/"');
  });

  it("labels a hyphenated slug readably", () => {
    expect(renderContentPage(fm, "<p>b</p>", "x", ["night-sky"])).toContain(">Night sky<");
  });
});

describe("datasetStats (spec 36 — counted, never typed by hand)", () => {
  const treks = [
    { name: "Skandagiri", tier: "curated", bestSeason: "Oct–Feb", landCover: "Forest" },
    { name: "Nandi Hills", tier: "curated", bestSeason: "Sep–Feb" },
    { name: "Unnamed peak (~912 m)", tier: "discovery", landCover: "Grassland" },
    { name: "Unnamed hill (~400 m)", tier: "discovery" },
  ];

  it("counts totals, named vs unnamed, and each enrichment field", () => {
    const s = datasetStats(treks, 3886);
    expect(s).toEqual({
      total: 4,
      curated: 2,
      named: 2,
      unnamed: 2,
      withSeason: 2,
      withCover: 2,
      pages: 3886,
    });
  });

  it("handles an empty dataset without dividing by anything", () => {
    expect(datasetStats([], 0)).toMatchObject({ total: 0, named: 0, unnamed: 0 });
  });
});

describe("dataPageMarkdown (spec 36)", () => {
  const stats = datasetStats(
    [{ name: "A", tier: "curated", bestSeason: "x", landCover: "Forest" }],
    7,
  );

  it("reports the computed counts, grouped for an Indian audience", () => {
    const md = dataPageMarkdown(
      { ...stats, total: 120441, named: 19351, unnamed: 101090 },
      "2026-09-19",
    );
    expect(md).toContain("1,20,441");
    expect(md).toContain("Still unnamed");
    expect(md).toContain("2026-09-19");
    expect(md).toContain("# The dataset");
  });

  it("omits the rebuild date when it is unknown rather than inventing one", () => {
    const md = dataPageMarkdown(stats);
    expect(md).not.toMatch(/last rebuilt on \*\*\s*\*\*/);
    expect(md).not.toContain("undefined");
  });
});

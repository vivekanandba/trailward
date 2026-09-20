import { describe, it, expect } from "vitest";
import { runBuildSitemap, lastCommitDate } from "./build-sitemap";
import { runBuildSearchIndex } from "./build-search-index";
import { runBuildPages } from "./build-pages";
import { memoryIO } from "./lib/buildIO";
import type { Trek } from "../src/lib/trek";

const trek = (over: Partial<Trek> & Pick<Trek, "id" | "name">): Trek => ({
  lat: 13,
  lng: 77,
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

const TREKS: Trek[] = [
  trek({ id: "skandagiri", name: "Skandagiri", tier: "curated", elevationM: 1350 }),
  trek({
    id: "gn-1",
    name: "Kumara Parvatha",
    highlights: "A long ridge walk.",
    lat: 12.6,
    lng: 75.6,
  }),
  trek({ id: "d12-1", name: "Unnamed peak (~912 m)", lat: 15, lng: 76 }),
];

const P = { treks: "/repo/src/data/treks.json", out: "/repo/public/sitemap.xml" };
const CONTENT = ["about.md", "sources.md"];

describe("sitemap ↔ pages agreement (CON-COV-003 — assert it from BOTH sides)", () => {
  // The sitemap advertises content URLs and build-pages writes them. While the
  // sitemap held its own hardcoded list the two could disagree in silence:
  // adding content/faq.md shipped a page nothing listed, and deleting
  // content/about.md advertised a URL that 404s. Both stayed green.
  const listings = [
    ["about.md", "sources.md"],
    ["about.md", "sources.md", "faq.md"], // a page added
    ["about.md"], // a page deleted
    ["about.md", "sources.md", "notes.txt"], // a non-markdown file ignored
  ];

  it("refuses a listing where an authored page collides with a generated one", () => {
    // The two tools disagree by construction here — contentSlugs dedupes to
    // [about, data] while build-pages would write "data" twice — so the only
    // correct behaviour is to refuse, and this pins that.
    const pages = memoryIO({
      ["/repo/src/data/treks.json"]: JSON.stringify(TREKS),
      ["/repo/content/about.md"]: "---\ntitle: T\ndescription: D\n---\n\nBody.",
      ["/repo/content/data.md"]: "---\ntitle: T\ndescription: D\n---\n\nBody.",
    });
    expect(() => runBuildPages(pages, "/repo", ["about.md", "data.md"])).toThrow(/collides/);
  });

  for (const listing of listings) {
    it(`agrees for [${listing.join(", ")}]`, () => {
      const io = memoryIO({ [P.treks]: JSON.stringify(TREKS) });
      runBuildSitemap(io, P, listing, "2026-09-19");
      const xml = io.files.get(P.out)!;

      const pages = memoryIO({
        ["/repo/src/data/treks.json"]: JSON.stringify(TREKS),
        ...Object.fromEntries(
          listing
            .filter((f) => f.endsWith(".md"))
            .map((f) => [`/repo/content/${f}`, "---\ntitle: T\ndescription: D\n---\n\nBody."]),
        ),
      });
      const written = runBuildPages(pages, "/repo", listing, "2026-09-19").content;

      const advertised = [...xml.matchAll(/<loc>[^<]*\/trailward\/([a-z-]+)\/<\/loc>/g)].map(
        (m) => m[1],
      );
      expect([...advertised].sort()).toEqual([...written].sort());
    });
  }
});

describe("build-sitemap run (spec 35/40)", () => {
  it("lists the app root, the content pages and every qualifying trek", () => {
    const io = memoryIO({ [P.treks]: JSON.stringify(TREKS) });
    const n = runBuildSitemap(io, P, CONTENT, "2026-09-19");
    const xml = io.files.get(P.out)!;

    expect(xml).toContain("<loc>https://vivekanandba.github.io/trailward/</loc>");
    for (const page of ["about", "sources", "data"]) {
      expect(xml).toContain(`/trailward/${page}/`);
    }
    expect(xml).toContain("/trailward/t/skandagiri/");
    expect(xml).toContain("<lastmod>2026-09-19</lastmod>");
    expect(n).toBeGreaterThan(3);
  });

  it("never advertises an Unnamed pin — nothing there to rank for", () => {
    const io = memoryIO({ [P.treks]: JSON.stringify(TREKS) });
    runBuildSitemap(io, P, CONTENT, "2026-09-19");
    expect(io.files.get(P.out)!).not.toContain("unnamed");
  });

  it("emits only absolute https locations", () => {
    const io = memoryIO({ [P.treks]: JSON.stringify(TREKS) });
    runBuildSitemap(io, P, CONTENT, "2026-09-19");
    const locs = [...io.files.get(P.out)!.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) expect(loc.startsWith("https://")).toBe(true);
  });

  it("is byte-stable for the same input and date", () => {
    const a = memoryIO({ [P.treks]: JSON.stringify(TREKS) });
    const b = memoryIO({ [P.treks]: JSON.stringify(TREKS) });
    runBuildSitemap(a, P, CONTENT, "2026-09-19");
    runBuildSitemap(b, P, CONTENT, "2026-09-19");
    expect(b.files.get(P.out)).toBe(a.files.get(P.out));
  });

  it("fails when the dataset is missing rather than writing an empty sitemap", () => {
    expect(() => runBuildSitemap(memoryIO(), P, CONTENT, undefined)).toThrow(/missing/);
  });
});

const S = { treks: "/repo/src/data/treks.json", out: "/repo/public/data/search-index.json" };

describe("build-search-index run (spec 38/40)", () => {
  it("indexes every NAMED summit and excludes the Unnamed ones", () => {
    const io = memoryIO({ [S.treks]: JSON.stringify(TREKS) });
    const index = runBuildSearchIndex(io, S);
    expect(index.map((e) => e.id).sort()).toEqual(["gn-1", "skandagiri"]);
    expect(JSON.stringify(index)).not.toContain("Unnamed");
  });

  it("is sorted by id, so the committed artefact diffs cleanly", () => {
    const io = memoryIO({ [S.treks]: JSON.stringify(TREKS) });
    const ids = runBuildSearchIndex(io, S).map((e) => e.id);
    // Must match the comparator the code uses. `[...ids].sort()` is UTF-16
    // order, which disagrees with localeCompare the moment an id starts with a
    // capital ("Skandagiri" vs "gn-1") — inert on today's data, wrong later.
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("refuses to write an empty index — that silently disables the palette", () => {
    const onlyUnnamed = JSON.stringify([TREKS[2]]);
    expect(() => runBuildSearchIndex(memoryIO({ [S.treks]: onlyUnnamed }), S)).toThrow(
      /refusing to write/,
    );
  });

  it("reports the entry count it actually wrote", () => {
    const io = memoryIO({ [S.treks]: JSON.stringify(TREKS) });
    runBuildSearchIndex(io, S);
    expect(io.logs.join()).toContain("2 named entries");
  });
});

describe("lastCommitDate (spec 35 — lastmod from the DATA's history)", () => {
  // vitest runs from the repo root, which is the git work tree we want.
  const repoRoot = process.cwd();

  it("reads an ISO date from this repo's own git history", () => {
    // A page whose facts did not change must not claim to have changed, or
    // every rebuild invites a recrawl of everything.
    expect(lastCommitDate("package.json", repoRoot)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns undefined for a path git has never seen, rather than today", () => {
    expect(lastCommitDate("no/such/file.xyz", repoRoot)).toBeUndefined();
  });

  it("returns undefined outside a git repository instead of throwing", () => {
    expect(lastCommitDate("package.json", "/")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { runBuildPages, pagePathsFor } from "./build-pages";
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
  trek({ id: "d12-9", name: "Unnamed peak (~912 m)", lat: 15, lng: 76 }),
];

const ROOT = "/repo";
const P = pagePathsFor(ROOT);

const ABOUT = [
  "---",
  "title: About",
  "description: What this is.",
  "---",
  "",
  "# About",
  "",
  "Body.",
].join("\n");

function seeded() {
  return memoryIO({
    [P.treks]: JSON.stringify(TREKS),
    [`${P.contentDir}/about.md`]: ABOUT,
  });
}

describe("build-pages run (spec 35/36/40)", () => {
  it("writes one page per qualifying trek, and never for an Unnamed pin", () => {
    const io = seeded();
    const out = runBuildPages(io, ROOT, ["about.md"], "2026-09-19");
    expect(io.files.has(`${P.outDir}/skandagiri/index.html`)).toBe(true);
    expect(io.files.has(`${P.outDir}/kumara-parvatha/index.html`)).toBe(true);
    expect([...io.files.keys()].some((k) => k.includes("unnamed"))).toBe(false);
    expect(out.treks).toBe(2);
  });

  it("renders the authored content page AND the generated data page", () => {
    const io = seeded();
    const out = runBuildPages(io, ROOT, ["about.md"], "2026-09-19");
    expect(out.content).toEqual(["about", "data"]);
    expect(io.files.get(`${P.distDir}/about/index.html`)).toContain("<h1");
    const data = io.files.get(`${P.distDir}/data/index.html`)!;
    // Counted from the dataset, never typed by hand.
    expect(data).toContain("Total summits");
    expect(data).toContain("2026-09-19");
  });

  it("the summary matches what was actually written", () => {
    const io = seeded();
    runBuildPages(io, ROOT, ["about.md"], "2026-09-19");
    expect(io.logs.join("\n")).toContain("wrote 2 trek page(s)");
    expect(io.logs.join("\n")).toContain("about, data");
  });

  it("is a clean rebuild — a page for a scrubbed record disappears", () => {
    const io = seeded();
    io.writeFile(`${P.outDir}/gone-hill/index.html`, "<html>stale</html>");
    runBuildPages(io, ROOT, ["about.md"], "2026-09-19");
    expect(io.files.has(`${P.outDir}/gone-hill/index.html`)).toBe(false);
  });

  it("cleans a path the CALLER CANNOT CHOOSE (CON-PROC-006)", () => {
    // The earlier version of this test passed an outDir and a repoRoot and
    // checked they matched — which constrains nothing, because the same caller
    // picked both. The guard is now that `/dist/t` is not the caller's to name:
    // whatever root they pass, the suffix is derived.
    for (const root of ["/a", "/b/c", "/repo/"]) {
      expect(pagePathsFor(root).outDir).toMatch(/\/dist\/t$/);
    }
    expect(pagePathsFor("/repo/").outDir).toBe("/repo/dist/t");

    for (const bad of ["relative/repo", "", "/repo/../etc"]) {
      expect(() => runBuildPages(seeded(), bad, ["about.md"]), bad).toThrow(/refusing to clean/);
    }
  });

  it("passes the REPO ROOT as the containment root, not something permissive", () => {
    // Asserting the guard directly does not pin this: /repo/dist/t is inside
    // "/" as well, so changing the argument to "/" — which disables
    // containment for every other path — is invisible unless the argument
    // itself is captured.
    const io = seeded();
    const calls: Array<[string, string]> = [];
    const spy = {
      ...io,
      removeDir: (path: string, within: string) => {
        calls.push([path, within]);
        io.removeDir(path, within);
      },
    };
    runBuildPages(spy, ROOT, ["about.md"], "2026-09-19");
    expect(calls).toEqual([["/repo/dist/t", "/repo"]]);
  });

  it("writes to the LITERAL expected locations, not wherever pagePathsFor says", () => {
    // Every other expectation here derives its paths from pagePathsFor, so
    // changing distDir to "/repo/dist-oops" left the whole suite green while
    // /about/, /sources/ and /data/ shipped outside dist/ and 404'd in
    // production. These literals are the only thing pinning the contract.
    const p = pagePathsFor("/repo");
    expect(p).toEqual({
      treks: "/repo/src/data/treks.json",
      outDir: "/repo/dist/t",
      distDir: "/repo/dist",
      contentDir: "/repo/content",
    });

    const io = seeded();
    runBuildPages(io, ROOT, ["about.md"], "2026-09-19");
    expect(io.files.has("/repo/dist/t/skandagiri/index.html")).toBe(true);
    expect(io.files.has("/repo/dist/about/index.html")).toBe(true);
    expect(io.files.has("/repo/dist/data/index.html")).toBe(true);
  });

  it("refuses an authored page that collides with a generated slug", () => {
    // content/data.md used to be rendered and then overwritten by the
    // generated /data/ page: the author's words vanished, the build reported
    // success, and the slug appeared twice in the summary.
    const io = seeded();
    io.writeFile("/repo/content/data.md", ABOUT);
    expect(() => runBuildPages(io, ROOT, ["about.md", "data.md"], "2026-09-19")).toThrow(
      /collides with the generated \/data\//,
    );
  });

  it("refuses to ship when content/ exists but holds no markdown", () => {
    // listDir returns [] for an empty directory, so the missing-directory
    // guard does not fire. Without this the build exits 0 having written only
    // /data/ while the sitemap still advertises /about/ and /sources/.
    const io = memoryIO({ [P.treks]: JSON.stringify(TREKS), "/repo/content/": "" });
    expect(() => runBuildPages(io, ROOT, [], "2026-09-19")).toThrow(/no content/);
  });

  it("wires the DERIVED nav into every page it writes", () => {
    // The renderer's own tests cover the nav, but nothing covered the seam
    // from contentSlugs into it: dropping the argument left every suite green
    // while every shipped footer lost its links.
    const io = seeded();
    io.writeFile(`${P.contentDir}/sources.md`, ABOUT);
    runBuildPages(io, ROOT, ["about.md", "sources.md"], "2026-09-19");
    for (const page of ["about", "sources", "data"]) {
      const html = io.files.get(`${P.distDir}/${page}/index.html`)!;
      expect(html, page).toContain('href="/trailward/about/"');
      expect(html, page).toContain('href="/trailward/sources/"');
      expect(html, page).toContain('href="/trailward/data/"');
    }
  });

  it("the nav FOLLOWS the listing — a renamed page renames the links", () => {
    const io = memoryIO({
      [P.treks]: JSON.stringify(TREKS),
      [`${P.contentDir}/faq.md`]: ABOUT,
    });
    runBuildPages(io, ROOT, ["faq.md"], "2026-09-19");
    const html = io.files.get(`${P.distDir}/faq/index.html`)!;
    expect(html).toContain('href="/trailward/faq/"');
    expect(html).not.toContain('href="/trailward/about/"');
    // The generated /data/ page must not link to a sources page that is gone.
    expect(io.files.get(`${P.distDir}/data/index.html`)!).not.toContain("/trailward/sources/");
  });

  it("a REFUSAL destroys nothing — the previous build survives intact", () => {
    // The refusals used to run after io.removeDir, so `git mv content/about.md
    // content/data.md && npm run build:pages` exited 1 having already wiped
    // dist/t and rewritten the content pages. Anything then serving dist/
    // (vite preview, a manual gh-pages push) shipped the half-built tree.
    const cases: Array<[string, string[]]> = [
      ["collision", ["about.md", "data.md"]],
      ["reserved t", ["about.md", "t.md"]],
      ["bad name", ["about.md", ".md"]],
      ["malformed frontmatter", ["about.md", "broken.md"]],
      ["bad markdown body", ["about.md", "zbadbody.md"]],
    ];
    for (const [label, listing] of cases) {
      const io = seeded();
      io.writeFile(`${P.contentDir}/data.md`, ABOUT);
      io.writeFile(`${P.contentDir}/t.md`, ABOUT);
      io.writeFile(`${P.contentDir}/.md`, ABOUT);
      io.writeFile(`${P.contentDir}/broken.md`, "no frontmatter here");
      // renderMarkdown throws by design on an http:// link. Parsing early but
      // RENDERING late still wiped dist/ before this could refuse — and prose
      // is edited constantly while filenames rarely are.
      io.writeFile(
        `${P.contentDir}/zbadbody.md`,
        ["---", "title: Bad", "description: d", "---", "", "[x](http://example.com)"].join("\n"),
      );
      io.writeFile(`${P.outDir}/skandagiri/index.html`, "GOOD PREVIOUS BUILD");
      io.writeFile(`${P.distDir}/about/index.html`, "GOOD PREVIOUS ABOUT");

      expect(() => runBuildPages(io, ROOT, listing, "2026-09-19"), label).toThrow();
      expect(io.files.get(`${P.outDir}/skandagiri/index.html`), label).toBe("GOOD PREVIOUS BUILD");
      expect(io.files.get(`${P.distDir}/about/index.html`), label).toBe("GOOD PREVIOUS ABOUT");
    }
  });

  it("refuses a file named .md instead of overwriting the SPA entry point", () => {
    // ".md".endsWith(".md") is true and the slug is "", so this wrote
    // dist//index.html — which POSIX collapses onto dist/index.html, silently
    // replacing the app itself, exit 0.
    const io = seeded();
    io.writeFile(`${P.contentDir}/.md`, ABOUT);
    expect(() => runBuildPages(io, ROOT, ["about.md", ".md"], "2026-09-19")).toThrow(
      /not a usable page name/,
    );
    expect(io.files.has(`${P.distDir}/index.html`)).toBe(false);
  });

  it("emits content pages in a stable order regardless of listing order", () => {
    // readdir order is not guaranteed, and these artefacts are committed.
    const forward = seeded();
    forward.writeFile(`${P.contentDir}/sources.md`, ABOUT);
    const reverse = seeded();
    reverse.writeFile(`${P.contentDir}/sources.md`, ABOUT);
    const a = runBuildPages(forward, ROOT, ["about.md", "sources.md"], "2026-09-19");
    const b = runBuildPages(reverse, ROOT, ["sources.md", "about.md"], "2026-09-19");
    expect(b.content).toEqual(a.content);
    expect(a.content).toEqual(["about", "sources", "data"]);
  });

  it("fails the build on malformed content rather than shipping a broken page", () => {
    const io = seeded();
    io.writeFile(`${P.contentDir}/bad.md`, "no frontmatter here");
    expect(() => runBuildPages(io, ROOT, ["about.md", "bad.md"], "2026-09-19")).toThrow(/bad\.md/);
  });

  it("is byte-stable across runs for the same input", () => {
    const a = seeded();
    const b = seeded();
    runBuildPages(a, ROOT, ["about.md"], "2026-09-19");
    runBuildPages(b, ROOT, ["about.md"], "2026-09-19");
    expect([...b.files.entries()].sort()).toEqual([...a.files.entries()].sort());
  });
});

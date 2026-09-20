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

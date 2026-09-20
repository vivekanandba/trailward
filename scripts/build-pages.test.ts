import { describe, it, expect } from "vitest";
import { runBuildPages, type PagePaths } from "./build-pages";
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

const P: PagePaths = {
  treks: "/repo/src/data/treks.json",
  outDir: "/repo/dist/t",
  distDir: "/repo/dist",
  contentDir: "/repo/content",
  repoRoot: "/repo",
};

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
    const out = runBuildPages(io, P, ["about.md"], "2026-09-19");
    expect(io.files.has(`${P.outDir}/skandagiri/index.html`)).toBe(true);
    expect(io.files.has(`${P.outDir}/kumara-parvatha/index.html`)).toBe(true);
    expect([...io.files.keys()].some((k) => k.includes("unnamed"))).toBe(false);
    expect(out.treks).toBe(2);
  });

  it("renders the authored content page AND the generated data page", () => {
    const io = seeded();
    const out = runBuildPages(io, P, ["about.md"], "2026-09-19");
    expect(out.content).toEqual(["about", "data"]);
    expect(io.files.get(`${P.distDir}/about/index.html`)).toContain("<h1");
    const data = io.files.get(`${P.distDir}/data/index.html`)!;
    // Counted from the dataset, never typed by hand.
    expect(data).toContain("Total summits");
    expect(data).toContain("2026-09-19");
  });

  it("the summary matches what was actually written", () => {
    const io = seeded();
    runBuildPages(io, P, ["about.md"], "2026-09-19");
    expect(io.logs.join("\n")).toContain("wrote 2 trek page(s)");
    expect(io.logs.join("\n")).toContain("about, data");
  });

  it("is a clean rebuild — a page for a scrubbed record disappears", () => {
    const io = seeded();
    io.writeFile(`${P.outDir}/gone-hill/index.html`, "<html>stale</html>");
    runBuildPages(io, P, ["about.md"], "2026-09-19");
    expect(io.files.has(`${P.outDir}/gone-hill/index.html`)).toBe(false);
  });

  it("refuses to clean a path that is not <repo>/dist/t (CON-PROC-006)", () => {
    const io = seeded();
    expect(() => runBuildPages(io, { ...P, outDir: "/repo/dist" }, ["about.md"])).toThrow(
      /refusing to clean/,
    );
  });

  it("fails the build on malformed content rather than shipping a broken page", () => {
    const io = seeded();
    io.writeFile(`${P.contentDir}/bad.md`, "no frontmatter here");
    expect(() => runBuildPages(io, P, ["about.md", "bad.md"], "2026-09-19")).toThrow(/bad\.md/);
  });

  it("is byte-stable across runs for the same input", () => {
    const a = seeded();
    const b = seeded();
    runBuildPages(a, P, ["about.md"], "2026-09-19");
    runBuildPages(b, P, ["about.md"], "2026-09-19");
    expect([...b.files.entries()].sort()).toEqual([...a.files.entries()].sort());
  });
});

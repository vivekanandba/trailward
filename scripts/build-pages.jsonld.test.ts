import { describe, it, expect, vi } from "vitest";

// The real renderer always agrees with itself now, so the build's R1 refusal
// can only be reached by a renderer that regresses. Stand one in: it writes
// the canonical correctly but the JSON-LD url from the id — the exact defect
// that shipped on 3,815 pages.
vi.mock("./lib/trekPage", async (orig) => {
  const real = await orig<typeof import("./lib/trekPage")>();
  return {
    ...real,
    renderTrekPage: (trek: { id: string }, slug: string) =>
      real
        .renderTrekPage(trek as never, slug)
        .replace(/"url":"[^"]*"/, `"url":"https://vivekanandba.github.io/trailward/t/${trek.id}/"`),
  };
});

const { runBuildPages, pagePathsFor } = await import("./build-pages");
const { memoryIO } = await import("./lib/buildIO");

describe("build-pages refuses a page whose JSON-LD url is not its own (spec 44 R1)", () => {
  it("refuses BEFORE writing, so the previous build survives", () => {
    const P = pagePathsFor("/repo");
    const io = memoryIO({
      [P.treks]: JSON.stringify([
        {
          id: "gn-1",
          name: "Kumara Parvatha",
          lat: 12.6,
          lng: 75.6,
          tier: "discovery",
          highlights: "A long ridge walk.",
          sources: [],
          verified: false,
        },
      ]),
      [`${P.contentDir}/about.md`]: "---\ntitle: About\ndescription: x\n---\n\n# About\n\nBody.",
    });
    io.writeFile(`${P.outDir}/old/index.html`, "GOOD PREVIOUS BUILD");
    expect(() => runBuildPages(io, "/repo", ["about.md"], "2026-10-10")).toThrow(
      /t\/kumara-parvatha\/: JSON-LD url .*\/t\/gn-1\/ is not the canonical/,
    );
    expect(io.files.get(`${P.outDir}/old/index.html`)).toBe("GOOD PREVIOUS BUILD");
    expect(io.files.has(`${P.outDir}/kumara-parvatha/index.html`)).toBe(false);
  });
});

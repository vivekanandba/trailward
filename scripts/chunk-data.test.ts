import { describe, it, expect } from "vitest";
import { runChunkData, chunkPathsFor } from "./chunk-data";
import { memoryIO } from "./lib/buildIO";
import type { Trek } from "../src/lib/trek";

const trek = (over: Partial<Trek> & Pick<Trek, "id" | "lat" | "lng">): Trek => ({
  name: over.id,
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

const TREKS: Trek[] = [
  trek({ id: "a", lat: 12.9, lng: 77.6 }), // cell 12_77
  trek({ id: "b", lat: 12.1, lng: 77.9 }), // cell 12_77
  trek({ id: "c", lat: 18.5, lng: 73.9 }), // cell 18_73
];

const ROOT = "/repo";
const paths = { treks: "/repo/src/data/treks.json", out: "/repo/public/data/cells" };

describe("chunk-data run (spec 30/40)", () => {
  it("writes one file per non-empty cell plus an index, and says what it wrote", () => {
    const io = memoryIO({ [paths.treks]: JSON.stringify(TREKS) });
    runChunkData(io, ROOT);

    expect(io.files.has(`${paths.out}/12_77.json`)).toBe(true);
    expect(io.files.has(`${paths.out}/18_73.json`)).toBe(true);
    const index = JSON.parse(io.files.get(`${paths.out}/index.json`)!) as {
      cells: Record<string, number>;
    };
    expect(index.cells).toEqual({ "12_77": 2, "18_73": 1 });

    // The summary must match what actually happened — a count that overstates
    // is how a partial bake reads as a complete one.
    expect(io.logs.join("\n")).toContain("2 cells");
    expect(io.logs.join("\n")).toContain("3 treks");
  });

  it("every record lands in exactly one cell — none lost, none duplicated", () => {
    const io = memoryIO({ [paths.treks]: JSON.stringify(TREKS) });
    runChunkData(io, ROOT);
    const ids = [...io.files.entries()]
      .filter(([k]) => k.startsWith(paths.out) && !k.endsWith("index.json"))
      .flatMap(([, body]) => (JSON.parse(body) as Trek[]).map((t) => t.id));
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("is a CLEAN rebuild — a cell that no longer has records disappears", () => {
    const io = memoryIO({
      [paths.treks]: JSON.stringify(TREKS),
      [`${paths.out}/99_99.json`]: "[]", // stale cell from a previous dataset
    });
    runChunkData(io, ROOT);
    expect(io.files.has(`${paths.out}/99_99.json`)).toBe(false);
  });

  it("orders cell keys by NAME, not by the order records happen to appear", () => {
    // Running the same input twice is byte-stable with or without the sort, so
    // that test cannot see this. Feeding the records in a different order can:
    // without `.sort()` the index key order follows insertion and index.json
    // churns on every rebake for no reason.
    const keysFor = (treks: Trek[]): string[] => {
      const io = memoryIO({ [paths.treks]: JSON.stringify(treks) });
      runChunkData(io, ROOT);
      return Object.keys(
        (JSON.parse(io.files.get(`${paths.out}/index.json`)!) as { cells: Record<string, number> })
          .cells,
      );
    };
    const forward = keysFor(TREKS);
    const reversed = keysFor([...TREKS].reverse());
    expect(reversed).toEqual(forward);
    expect(forward).toEqual([...forward].sort());
  });

  it("is byte-stable across runs — these artefacts are committed", () => {
    const once = memoryIO({ [paths.treks]: JSON.stringify(TREKS) });
    runChunkData(once, ROOT);
    const twice = memoryIO({ [paths.treks]: JSON.stringify(TREKS) });
    runChunkData(twice, ROOT);
    expect([...twice.files.entries()].sort()).toEqual([...once.files.entries()].sort());
  });

  it("derives its output path and REFUSES a root that is not absolute", () => {
    // CON-PROC-006 says test the refusal, not just the success. Without this,
    // deleting the guard entirely left the whole suite green — and
    // chunkPathsFor("../..") would then rm -rf ../../public/data/cells, which
    // nodeIO.removeDir cannot catch because a relative non-symlink path
    // resolves to itself.
    expect(chunkPathsFor("/repo").out).toBe("/repo/public/data/cells");
    expect(chunkPathsFor("/repo/").out).toBe("/repo/public/data/cells");
    for (const bad of ["../..", "relative", "", "/repo/../etc", "."]) {
      expect(() => chunkPathsFor(bad), JSON.stringify(bad)).toThrow(/refusing to chunk/);
      expect(() => runChunkData(memoryIO(), bad), JSON.stringify(bad)).toThrow(/refusing to chunk/);
    }
  });

  it("refuses an empty dataset rather than erasing every served cell", () => {
    const io = memoryIO({
      [paths.treks]: "[]",
      [`${paths.out}/12_77.json`]: "[...]",
    });
    expect(() => runChunkData(io, ROOT)).toThrow(/empty/i);
    // The previous chunks survive: an empty bake must not take the app down.
    expect(io.files.has(`${paths.out}/12_77.json`)).toBe(true);
  });
});

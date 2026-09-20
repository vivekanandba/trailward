import { describe, it, expect } from "vitest";
import { runBuildLandCover, landCoverPathsFor, MAX_DROP_FRACTION } from "./build-landcover";
import { memoryIO } from "./lib/buildIO";
import type { Trek } from "../src/lib/trek";

const trek = (over: Partial<Trek> & Pick<Trek, "id" | "lat" | "lng">): Trek => ({
  name: over.id,
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

// WorldCover class codes: 10 = Tree cover ("Forest"), 80 = permanent water.
const FOREST = 10;
const WATER = 80;

const ROOT = "/repo";
const P = landCoverPathsFor(ROOT);
const seeded = (treks: Trek[]) => memoryIO({ [P.treks]: JSON.stringify(treks) });
const read = (io: ReturnType<typeof seeded>) => JSON.parse(io.files.get(P.treks)!) as Trek[];

describe("build-landcover run (spec 41)", () => {
  it("bakes the dominant class onto every sampled record", async () => {
    const io = seeded([trek({ id: "a", lat: 13, lng: 77 }), trek({ id: "b", lat: 14, lng: 78 })]);
    const out = await runBuildLandCover(io, ROOT, { classesAt: async (p) => p.map(() => FOREST) });
    expect(out.baked).toBe(2);
    expect(read(io).every((t) => t.landCover === "Forest")).toBe(true);
    expect(out.counts.get("Forest")).toBe(2);
  });

  it("drops a DETECTED pin standing in open water — a corrupt DEM sample", async () => {
    // Enough records that a single drop stays inside the tolerance; the
    // tolerance itself is exercised by its own test below.
    const many = Array.from({ length: 40 }, (_, i) => trek({ id: `r${i}`, lat: 13, lng: 77 }));
    const io = seeded([
      ...many,
      trek({ id: "ghost", lat: 20, lng: 78, detected: { prominenceM: 50 } } as never),
    ]);
    const out = await runBuildLandCover(io, ROOT, {
      classesAt: async (pts) => pts.map(() => (pts[0].lat > 15 ? WATER : FOREST)),
    });
    expect(out.dropped).toBe(1);
    expect(read(io).map((t) => t.id)).not.toContain("ghost");
    expect(read(io).length).toBe(40);
  });

  it("KEEPS a curated trek in water — only detected pins are corrupt by definition", async () => {
    const io = seeded([
      trek({
        id: "jetty",
        lat: 13,
        lng: 77,
        tier: "curated",
        sources: ["https://example.org/x"],
        verified: true,
      }),
    ]);
    const out = await runBuildLandCover(io, ROOT, { classesAt: async (p) => p.map(() => WATER) });
    expect(out.dropped).toBe(0);
    expect(read(io)[0].landCover).toBe("Water");
  });

  it("drops a STALE value when the sample returns nothing, never keeps a wrong one", async () => {
    const io = seeded([trek({ id: "a", lat: 13, lng: 77, landCover: "Forest" })]);
    await runBuildLandCover(io, ROOT, { classesAt: async (p) => p.map(() => undefined) });
    expect(read(io)[0].landCover).toBeUndefined();
  });

  it("REFUSES a run that would drop more than the tolerance (the WorldCover incident)", async () => {
    // Every record a detected pin, every sample reading water: that is the
    // source failing, not the terrain changing. A transient header error once
    // cached null for a whole 3° tile and wiped ~113k records this way.
    const many = Array.from({ length: 20 }, (_, i) =>
      trek({ id: `d${i}`, lat: 13 + i * 0.01, lng: 77, detected: { prominenceM: 50 } } as never),
    );
    const io = seeded(many);
    const before = io.files.get(P.treks);
    await expect(
      runBuildLandCover(io, ROOT, { classesAt: async (p) => p.map(() => WATER) }),
    ).rejects.toThrow(/refusing to write/);
    expect(io.files.get(P.treks)).toBe(before);
  });

  it("permits a drop within tolerance", async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      trek({
        id: `d${i}`,
        lat: 13 + i * 0.01,
        lng: 77,
        ...(i === 0 ? { detected: { prominenceM: 50 } } : {}),
      } as never),
    );
    const io = seeded(many);
    const out = await runBuildLandCover(io, ROOT, {
      classesAt: async (pts) => pts.map(() => (pts[0].lat < 13.005 ? WATER : FOREST)),
    });
    expect(out.dropped).toBe(1);
    expect(1 / 100).toBeLessThanOrEqual(MAX_DROP_FRACTION);
  });

  it("preserves the dataset's ORIGINAL order despite sampling spatially", async () => {
    // Sampling walks COG-then-cell order for cache locality; the written file
    // must still be in the order it arrived, or every diff is noise.
    const ids = ["z", "a", "m"];
    const io = seeded([
      trek({ id: "z", lat: 22, lng: 88 }),
      trek({ id: "a", lat: 13, lng: 77 }),
      trek({ id: "m", lat: 18, lng: 73 }),
    ]);
    await runBuildLandCover(io, ROOT, { classesAt: async (p) => p.map(() => FOREST) });
    expect(read(io).map((t) => t.id)).toEqual(ids);
  });

  it("refuses a dataset the validator rejects rather than writing it", async () => {
    const io = seeded([{ ...trek({ id: "a", lat: 13, lng: 77 }), lat: 999 } as Trek]);
    await expect(
      runBuildLandCover(io, ROOT, { classesAt: async (p) => p.map(() => FOREST) }),
    ).rejects.toThrow(/invalid/);
  });

  it("derives its paths and refuses a root that is not absolute (CON-PROC-006)", () => {
    expect(landCoverPathsFor("/x").treks).toBe("/x/src/data/treks.json");
    for (const bad of ["relative", "", "/x/../y"]) {
      expect(() => landCoverPathsFor(bad), JSON.stringify(bad)).toThrow(/refusing/);
    }
  });
});

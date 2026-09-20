import { describe, it, expect } from "vitest";
import { runBuildClimate, climatePathsFor, cellsFor } from "./build-climate";
import { memoryIO } from "./lib/buildIO";
import type { Trek } from "../src/lib/trek";
import type { MonthlyRain } from "../src/lib/climate";

const trek = (over: Partial<Trek> & Pick<Trek, "id" | "lat" | "lng">): Trek => ({
  name: over.id,
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

const TREKS: Trek[] = [
  trek({ id: "a", lat: 13.4, lng: 77.7 }),
  trek({ id: "b", lat: 13.45, lng: 77.72 }), // same climate cell as "a"
  trek({ id: "far", lat: 18.5, lng: 73.9 }),
  trek({
    id: "curated",
    lat: 13.4,
    lng: 77.7,
    tier: "curated",
    bestSeason: "Hand-written",
    sources: ["https://example.org/x"],
    verified: true,
  }),
];

// A dry-winter monsoon profile: heavy Jun–Sep, dry Nov–Feb.
const MONSOON: MonthlyRain = [4, 3, 6, 25, 90, 180, 240, 210, 150, 60, 10, 3];

const ROOT = "/repo";
const P = climatePathsFor(ROOT);

const seeded = (treks = TREKS, climate?: Record<string, MonthlyRain>) =>
  memoryIO({
    [P.treks]: JSON.stringify(treks),
    ...(climate ? { [P.climate]: JSON.stringify(climate) } : {}),
  });

describe("build-climate run (spec 41)", () => {
  it("samples one cell per distinct grid square, not one per trek", () => {
    const cells = cellsFor(TREKS);
    // a, b and curated share a cell; far is its own.
    expect(cells.length).toBe(2);
    expect(new Set(cells.map((c) => c.key)).size).toBe(2);
  });

  it("bakes a season onto discovery peaks and writes both artefacts", async () => {
    const io = seeded();
    const out = await runBuildClimate(io, ROOT, {
      fetchRain: async (cells) => new Map(cells.map((c) => [c.key, MONSOON])),
    });

    expect(out.baked).toBe(3); // a, b, far — not the curated one
    const written = JSON.parse(io.files.get(P.treks)!) as Trek[];
    expect(written.find((t) => t.id === "a")!.bestSeason).toBeTruthy();
    expect(Object.keys(JSON.parse(io.files.get(P.climate)!)).length).toBe(2);
  });

  it("NEVER overwrites hand-written curated guidance", async () => {
    const io = seeded();
    await runBuildClimate(io, ROOT, {
      fetchRain: async (cells) => new Map(cells.map((c) => [c.key, MONSOON])),
    });
    const written = JSON.parse(io.files.get(P.treks)!) as Trek[];
    expect(written.find((t) => t.id === "curated")!.bestSeason).toBe("Hand-written");
  });

  it("resumes on the VALUE — a sampled cell is not re-fetched (spec 41 §B.7)", async () => {
    const cells = cellsFor(TREKS);
    const io = seeded(TREKS, { [cells[0].key]: MONSOON });
    const asked: string[] = [];
    await runBuildClimate(io, ROOT, {
      fetchRain: async (c) => {
        asked.push(...c.map((x) => x.key));
        return new Map(c.map((x) => [x.key, MONSOON]));
      },
    });
    expect(asked).not.toContain(cells[0].key);
    expect(asked).toContain(cells[1].key);
  });

  it("does no network work at all when every cell is already sampled", async () => {
    const all = Object.fromEntries(cellsFor(TREKS).map((c) => [c.key, MONSOON]));
    const io = seeded(TREKS, all);
    let called = 0;
    await runBuildClimate(io, ROOT, {
      fetchRain: async () => {
        called++;
        return new Map();
      },
    });
    expect(called).toBe(0);
  });

  it("REFUSES when nothing is returned and nothing was banked", async () => {
    const io = seeded();
    io.writeFile(P.climate, JSON.stringify({}));
    const before = io.files.get(P.treks);
    await expect(runBuildClimate(io, ROOT, { fetchRain: async () => new Map() })).rejects.toThrow(
      /refusing to write/,
    );
    // The previous dataset must survive: a refusal that destroys is not a refusal.
    expect(io.files.get(P.treks)).toBe(before);
  });

  it("still writes when the fetch fails but earlier samples exist", async () => {
    const all = Object.fromEntries(cellsFor(TREKS).map((c) => [c.key, MONSOON]));
    // Drop one so there is work to do, and have it come back empty.
    delete all[cellsFor(TREKS)[1].key];
    const io = seeded(TREKS, all);
    await expect(
      runBuildClimate(io, ROOT, { fetchRain: async () => new Map() }),
    ).resolves.toBeTruthy();
  });

  it("BANKS the rainfall even when the dataset then fails validation", async () => {
    // climate.json is an additive observation cache and cannot be invalidated
    // by a treks.json problem. Making its write conditional would throw away
    // hours of rate-limited sampling because of something unrelated, and the
    // next run would re-fetch from zero.
    const io = seeded([{ ...TREKS[0], lat: 999 } as Trek]);
    await expect(
      runBuildClimate(io, ROOT, {
        fetchRain: async (c) => new Map(c.map((x) => [x.key, MONSOON])),
      }),
    ).rejects.toThrow(/invalid/);
    expect(io.files.has(P.climate)).toBe(true);
    expect(Object.keys(JSON.parse(io.files.get(P.climate)!)).length).toBeGreaterThan(0);
  });

  it("does not write treks.json when validation fails", async () => {
    const io = seeded([{ ...TREKS[0], lat: 999 } as Trek]);
    const before = io.files.get(P.treks);
    await expect(
      runBuildClimate(io, ROOT, {
        fetchRain: async (c) => new Map(c.map((x) => [x.key, MONSOON])),
      }),
    ).rejects.toThrow(/invalid/);
    expect(io.files.get(P.treks)).toBe(before);
  });

  it("refuses a dataset the validator rejects rather than writing it", async () => {
    const io = seeded([{ ...TREKS[0], lat: 999 } as Trek]);
    await expect(
      runBuildClimate(io, ROOT, {
        fetchRain: async (c) => new Map(c.map((x) => [x.key, MONSOON])),
      }),
    ).rejects.toThrow(/invalid/);
  });

  it("derives its paths and refuses a root that is not absolute (CON-PROC-006)", () => {
    expect(climatePathsFor("/x").treks).toBe("/x/src/data/treks.json");
    for (const bad of ["relative", "", "/x/../y", ".."]) {
      expect(() => climatePathsFor(bad), JSON.stringify(bad)).toThrow(/refusing/);
    }
  });
});

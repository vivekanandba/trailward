import { describe, it, expect } from "vitest";
import {
  runBuildNames,
  namesPathsFor,
  namerFeatureFrom,
  cellKeyFor,
  featuresNear,
} from "./build-names";
import { memoryIO } from "./lib/buildIO";
import type { NamerFeature } from "./sources/nameinfer";
import type { Trek } from "../src/lib/trek";

const ROOT = "/repo";
const P = namesPathsFor(ROOT);

const summit = (over: { id: string; name: string; lat: number; lng: number }) => ({
  tier: "discovery" as const,
  sources: [] as string[],
  verified: false,
  elevationM: 900,
  ...over,
});

/** A reserved forest sitting ~200 m from the summit, which should name it. */
const NEARBY: NamerFeature = { name: "Devarayanadurga", code: "FRST", lat: 13.3702, lng: 77.2 };

const gridWith = (...fs: NamerFeature[]): Map<string, NamerFeature[]> => {
  const g = new Map<string, NamerFeature[]>();
  for (const f of fs) {
    const k = cellKeyFor(f.lat, f.lng);
    (g.get(k) ?? g.set(k, []).get(k)!).push(f);
  }
  return g;
};

const seeded = (summits: unknown[], treks: Trek[] = []) =>
  memoryIO({
    [P.detected]: JSON.stringify(summits),
    [P.treks]: JSON.stringify(treks),
  });

describe("namerFeatureFrom (spec 28/41)", () => {
  const line = (over: Partial<Record<number, string>> = {}): string => {
    const c = new Array(19).fill("");
    c[1] = "Devarayanadurga";
    c[4] = "13.37";
    c[5] = "77.2";
    c[7] = "FRST";
    for (const [i, v] of Object.entries(over)) c[Number(i)] = v!;
    return c.join("\t");
  };

  it("parses a usable namer row", () => {
    expect(namerFeatureFrom(line())).toEqual({
      name: "Devarayanadurga",
      code: "FRST",
      lat: 13.37,
      lng: 77.2,
    });
  });

  it("skips a feature class that never names a hill", () => {
    expect(namerFeatureFrom(line({ 7: "HTL" }))).toBeNull();
  });

  it("skips rows with an unusable coordinate or no name", () => {
    expect(namerFeatureFrom(line({ 4: "not-a-number" }))).toBeNull();
    expect(namerFeatureFrom(line({ 1: "" }))).toBeNull();
  });

  it("skips a BLANK coordinate rather than reading it as zero", () => {
    // Number("") is 0, so a blank longitude used to place the feature at 0°E
    // in the Atlantic instead of skipping the row (CON-DATA-001 — a missing
    // value must not become a real one).
    expect(namerFeatureFrom(line({ 5: "" }))).toBeNull();
    expect(namerFeatureFrom(line({ 4: "   " }))).toBeNull();
  });
});

describe("featuresNear (spec 28)", () => {
  it("reaches into the neighbouring buckets, not just its own", () => {
    // A feature just over a cell boundary must still be found, or a summit
    // sitting near the edge of a bucket is never named.
    const g = gridWith(NEARBY);
    expect(featuresNear(g, NEARBY.lat + 0.011, NEARBY.lng).length).toBe(1);
    expect(featuresNear(g, NEARBY.lat + 5, NEARBY.lng).length).toBe(0);
  });
});

describe("build-names run (spec 28/41)", () => {
  it("names an Unnamed summit from the adjacent feature and records provenance", async () => {
    const io = seeded([
      summit({ id: "d12-1", name: "Unnamed peak (~900 m)", lat: 13.37, lng: 77.2 }),
    ]);
    const out = await runBuildNames(io, ROOT, { loadGrid: async () => gridWith(NEARBY) });

    expect(out.named).toBe(1);
    const written = JSON.parse(io.files.get(P.detected)!) as Array<{
      name: string;
      inferredFrom?: string;
    }>;
    expect(written[0].name).toBe("Devarayanadurga");
    // Provenance is recorded, and says plainly that it is unverified
    // (CON-DATA-001 — an inference must never read as an observation).
    expect(written[0].inferredFrom).toMatch(/GeoNames/);
    expect(written[0].inferredFrom).toMatch(/unverified/);
  });

  it("NEVER overwrites a name that is not 'Unnamed…'", async () => {
    const io = seeded([summit({ id: "d12-1", name: "Someone's Hill", lat: 13.37, lng: 77.2 })]);
    const out = await runBuildNames(io, ROOT, { loadGrid: async () => gridWith(NEARBY) });
    expect(out.named).toBe(0);
    expect((JSON.parse(io.files.get(P.detected)!) as Array<{ name: string }>)[0].name).toBe(
      "Someone's Hill",
    );
  });

  it("leaves a summit with no nearby feature alone", async () => {
    const io = seeded([summit({ id: "d12-1", name: "Unnamed peak (~900 m)", lat: 20, lng: 80 })]);
    const out = await runBuildNames(io, ROOT, { loadGrid: async () => gridWith(NEARBY) });
    expect(out.named).toBe(0);
  });

  it("patches an already-baked d12- record, keeping its other fields", async () => {
    const baked: Trek = {
      id: "d12-1",
      name: "Unnamed peak (~900 m)",
      lat: 13.37,
      lng: 77.2,
      tier: "discovery",
      sources: [],
      verified: false,
      landCover: "Forest",
    };
    const io = seeded(
      [summit({ id: "d12-1", name: "Unnamed peak (~900 m)", lat: 13.37, lng: 77.2 })],
      [baked],
    );
    const out = await runBuildNames(io, ROOT, { loadGrid: async () => gridWith(NEARBY) });

    expect(out.patched).toBe(1);
    const treks = JSON.parse(io.files.get(P.treks)!) as Trek[];
    expect(treks[0].name).toBe("Devarayanadurga");
    expect(treks[0].landCover).toBe("Forest"); // untouched
    expect(treks[0].highlights).toMatch(/unverified/);
  });

  it("leaves non-detected records entirely alone", async () => {
    const curated: Trek = {
      id: "skandagiri",
      name: "Skandagiri",
      lat: 13.37,
      lng: 77.2,
      tier: "curated",
      sources: ["https://example.org/x"],
      verified: true,
    };
    const io = seeded(
      [summit({ id: "d12-1", name: "Unnamed peak (~900 m)", lat: 13.37, lng: 77.2 })],
      [curated],
    );
    const out = await runBuildNames(io, ROOT, { loadGrid: async () => gridWith(NEARBY) });
    expect(out.patched).toBe(0);
    expect((JSON.parse(io.files.get(P.treks)!) as Trek[])[0]).toEqual(curated);
  });

  it("REFUSES an empty namer grid — a missing dump is not 'nothing to name'", async () => {
    const io = seeded([
      summit({ id: "d12-1", name: "Unnamed peak (~900 m)", lat: 13.37, lng: 77.2 }),
    ]);
    const before = io.files.get(P.detected);
    await expect(runBuildNames(io, ROOT, { loadGrid: async () => new Map() })).rejects.toThrow(
      /refusing to write/,
    );
    expect(io.files.get(P.detected)).toBe(before);
  });

  it("refuses a dataset the validator rejects rather than writing it", async () => {
    const io = seeded(
      [summit({ id: "d12-1", name: "Unnamed peak (~900 m)", lat: 13.37, lng: 77.2 })],
      [
        {
          id: "d12-9",
          name: "x",
          lat: 999,
          lng: 77,
          tier: "discovery",
          sources: [],
          verified: false,
        },
      ],
    );
    await expect(
      runBuildNames(io, ROOT, { loadGrid: async () => gridWith(NEARBY) }),
    ).rejects.toThrow(/invalid/);
  });

  it("derives its paths and refuses a root that is not absolute (CON-PROC-006)", () => {
    expect(namesPathsFor("/x").treks).toBe("/x/src/data/treks.json");
    for (const bad of ["relative", "", "/x/../y"]) {
      expect(() => namesPathsFor(bad), JSON.stringify(bad)).toThrow(/refusing/);
    }
  });
});

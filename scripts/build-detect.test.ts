import { describe, it, expect } from "vitest";
import {
  runBuildDetect,
  detectPathsFor,
  buildIndiaMask,
  inIndia,
  type DetectedSummit,
} from "./build-detect";
import { memoryIO } from "./lib/buildIO";
import type { DetectedPeak } from "./sources/peakdetect";
import type { Trek } from "../src/lib/trek";

const ROOT = "/repo";
const P = detectPathsFor(ROOT);

const peak = (over: Partial<DetectedPeak> & Pick<DetectedPeak, "lat" | "lng">): DetectedPeak => ({
  elevationM: 900,
  reliefM: 200,
  ...over,
});

const summit = (over: Partial<DetectedSummit> & Pick<DetectedSummit, "id">): DetectedSummit => ({
  name: "Unnamed peak (~900 m)",
  lat: 13.4,
  lng: 77.7,
  elevationM: 900,
  reliefM: 200,
  prominenceProxyM: 150,
  meanSlopeDeg: 18,
  terrainConfidence: 0.8,
  discoveryScore: 0.6,
  estimatedDifficulty: "Moderate",
  ...over,
});

/** A mask covering the Bengaluru area, built the way the real one is. */
const MASK = buildIndiaMask([{ lat: 13.4, lng: 77.7 }]);

const seeded = (treks: Trek[] = [], existing?: DetectedSummit[]) =>
  memoryIO({
    [P.treks]: JSON.stringify(treks),
    ...(existing ? { [P.out]: JSON.stringify(existing) } : {}),
  });

const deps = (over: Partial<Parameters<typeof runBuildDetect>[2]> = {}) => ({
  detect: async () => [peak({ lat: 13.4, lng: 77.7 })],
  loadMask: async () => MASK,
  score: async (ps: DetectedPeak[]) => ps.map((_, i) => summit({ id: `d12-${i}` })),
  ...over,
});

describe("India mask (spec 27/30)", () => {
  it("accepts a point inside the mask and rejects one far outside", () => {
    expect(inIndia({ lat: 13.4, lng: 77.7 }, MASK)).toBe(true);
    expect(inIndia({ lat: 48.8, lng: 2.3 }, MASK)).toBe(false); // Paris
  });

  it("reaches into neighbouring cells so a coastal point is not cut off", () => {
    const mask = buildIndiaMask([{ lat: 13.0, lng: 77.0 }]);
    expect(inIndia({ lat: 13.0, lng: 77.0 }, mask)).toBe(true);
    expect(inIndia({ lat: 30.0, lng: 77.0 }, mask)).toBe(false);
  });
});

describe("build-detect run (spec 27/41)", () => {
  it("writes the scored summits and reports what it wrote", async () => {
    const io = seeded();
    const out = await runBuildDetect(io, ROOT, deps());
    expect(out.written).toBe(1);
    expect(JSON.parse(io.files.get(P.out)!)).toHaveLength(1);
    expect(io.logs.join("\n")).toContain("wrote 1 detected summits");
  });

  it("drops a candidate OUTSIDE the mask before anything is scored", async () => {
    const scored: DetectedPeak[][] = [];
    const io = seeded();
    await expect(
      runBuildDetect(
        io,
        ROOT,
        deps({
          detect: async () => [peak({ lat: 48.8, lng: 2.3 })], // Paris
          score: async (ps) => {
            scored.push(ps);
            return [];
          },
        }),
      ),
    ).rejects.toThrow(/refusing to write/);
    expect(scored[0]).toEqual([]); // nothing survived the mask
  });

  it("drops a candidate the databases ALREADY know", async () => {
    // A pin within the dedup radius means this is not a discovery.
    const known: Trek = {
      id: "skandagiri",
      name: "Skandagiri",
      lat: 13.4,
      lng: 77.7,
      tier: "curated",
      sources: ["https://example.org/x"],
      verified: true,
    };
    const io = seeded([known]);
    await expect(runBuildDetect(io, ROOT, deps())).rejects.toThrow(/refusing to write/);
  });

  it("applies the plausibility gate and says how many it dropped", async () => {
    const io = seeded();
    const out = await runBuildDetect(
      io,
      ROOT,
      deps({
        detect: async () => [peak({ lat: 13.4, lng: 77.7 }), peak({ lat: 13.41, lng: 77.71 })],
        score: async () => [
          summit({ id: "good" }),
          // A mean slope above 60° is not a hill, it is a corrupt sample.
          summit({ id: "impossible", meanSlopeDeg: 89 }),
        ],
      }),
    );
    expect(out.written).toBe(1);
    expect(io.logs.join("\n")).toContain("plausibility gate dropped 1");
    expect(JSON.parse(io.files.get(P.out)!)).toEqual([expect.objectContaining({ id: "good" })]);
  });

  it("REFUSES to replace a large committed set with a handful", async () => {
    // filterUnknown compares candidates against every pin in treks.json, which
    // already contains this tool's prior output — so a careless re-run filters
    // almost everything out as "known". Refusing only at exactly zero is a
    // coin flip: a residue of one would overwrite the whole committed tier.
    const previous = Array.from({ length: 100 }, (_, i) => summit({ id: `p${i}` }));
    const io = seeded([], previous);
    const before = io.files.get(P.out);
    await expect(
      runBuildDetect(io, ROOT, deps({ score: async () => [summit({ id: "lonely" })] })),
    ).rejects.toThrow(/refusing to write/);
    expect(io.files.get(P.out)).toBe(before);
  });

  it("permits a normal run that keeps most of the committed set", async () => {
    const previous = Array.from({ length: 100 }, (_, i) => summit({ id: `p${i}` }));
    const io = seeded([], previous);
    const out = await runBuildDetect(
      io,
      ROOT,
      deps({
        detect: async () => [peak({ lat: 13.4, lng: 77.7 })],
        score: async () => Array.from({ length: 95 }, (_, i) => summit({ id: `n${i}` })),
      }),
    );
    expect(out.written).toBe(95);
  });

  it("REFUSES to write an empty set — that would erase a whole tier", async () => {
    const io = seeded([], [summit({ id: "previous" })]);
    const before = io.files.get(P.out);
    await expect(runBuildDetect(io, ROOT, deps({ score: async () => [] }))).rejects.toThrow(
      /refusing to write/,
    );
    // The committed set survives: a refusal that destroys is not a refusal.
    expect(io.files.get(P.out)).toBe(before);
  });

  it("refuses when the gate rejects EVERYTHING, not just when nothing was found", async () => {
    const io = seeded([], [summit({ id: "previous" })]);
    const before = io.files.get(P.out);
    await expect(
      runBuildDetect(
        io,
        ROOT,
        deps({ score: async () => [summit({ id: "x", meanSlopeDeg: 89 })] }),
      ),
    ).rejects.toThrow(/refusing to write/);
    expect(io.files.get(P.out)).toBe(before);
  });

  it("passes --calibrate THROUGH to the detector, not just to the report", async () => {
    // detectIndia lowers its relief floor to 60 m when calibrating. A mis-wire
    // would scan at the 100 m production floor while printing a table headed
    // "relief >= 60 m" — a wrong calibration with no error.
    const seen: boolean[] = [];
    const io = seeded([], [summit({ id: "previous" })]);
    await runBuildDetect(
      io,
      ROOT,
      deps({
        detect: async (c) => {
          seen.push(c);
          return [peak({ lat: 13.4, lng: 77.7 })];
        },
      }),
      true,
    );
    expect(seen).toEqual([true]);
  });

  it("--calibrate reports counts and writes NOTHING", async () => {
    const io = seeded([], [summit({ id: "previous" })]);
    const before = io.files.get(P.out);
    const out = await runBuildDetect(io, ROOT, deps(), true);
    expect(out.written).toBe(0);
    expect(io.files.get(P.out)).toBe(before);
    expect(io.logs.join("\n")).toContain("relief ≥ 150 m");
  });

  it("de-duplicates candidates that land on the same DEM pixel", async () => {
    const io = seeded();
    const out = await runBuildDetect(
      io,
      ROOT,
      deps({
        detect: async () => [peak({ lat: 13.4, lng: 77.7 }), peak({ lat: 13.4, lng: 77.7 })],
      }),
    );
    expect(out.candidates).toBe(1);
  });

  it("derives its paths and refuses a root that is not absolute (CON-PROC-006)", () => {
    expect(detectPathsFor("/x").out).toBe("/x/scripts/detected/india-detected.json");
    for (const bad of ["relative", "", "/x/../y"]) {
      expect(() => detectPathsFor(bad), JSON.stringify(bad)).toThrow(/refusing/);
    }
  });
});

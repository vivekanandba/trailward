import { describe, it, expect } from "vitest";
import { runBuildGeonames, summitFrom } from "./build-geonames";
import { memoryIO } from "../lib/buildIO";

const OUT = "/repo/src/data/geonames-summits.json";

/**
 * A GeoNames dump row. Column order is the published tab-separated format:
 * 0 id · 1 name · 3 altnames · 4 lat · 5 lng · 6 feature class · 7 feature code
 * · 15 elevation · 16 SRTM dem.
 */
const row = (over: Partial<Record<number, string>> = {}): string => {
  const c = new Array(19).fill("");
  c[0] = "1270000";
  c[1] = "Nandi Hills";
  c[3] = "Nandidurga,Nandi Betta";
  c[4] = "13.3702";
  c[5] = "77.6835";
  c[6] = "T";
  c[7] = "MT";
  c[15] = "1478";
  for (const [i, v] of Object.entries(over)) c[Number(i)] = v!;
  return c.join("\t");
};

const linesOf = (...ls: string[]) =>
  async function* () {
    for (const l of ls) yield l;
  };

const noop = async () => {};

describe("summitFrom (spec 18/41)", () => {
  it("parses a summit row, keeping elevation and alternate names", () => {
    const s = summitFrom(row())!;
    expect(s).toMatchObject({ id: "1270000", name: "Nandi Hills", elevationM: 1478 });
    expect(s.altNames).toContain("Nandidurga");
  });

  it("skips anything that is not a summit feature", () => {
    expect(summitFrom(row({ 6: "P" }))).toBeNull(); // populated place
    expect(summitFrom(row({ 7: "HTL" }))).toBeNull(); // hotel
  });

  it("skips a row outside the reachable bounds", () => {
    expect(summitFrom(row({ 4: "48.8", 5: "2.3" }))).toBeNull(); // Paris
  });

  it("skips a BLANK coordinate rather than reading it as zero", () => {
    // Number("") is 0, which would place the summit at 0°N/0°E in the Atlantic.
    expect(summitFrom(row({ 4: "" }))).toBeNull();
    expect(summitFrom(row({ 5: "  " }))).toBeNull();
  });

  it("falls back to the SRTM column when elevation is absent", () => {
    expect(summitFrom(row({ 15: "", 16: "1200" }))!.elevationM).toBe(1200);
  });

  it("leaves elevation undefined rather than inventing an implausible one", () => {
    // A field left blank because nothing was measured is information;
    // a fabricated one reads as fact (CON-DATA-001).
    expect(summitFrom(row({ 15: "-50", 16: "" }))!.elevationM).toBeUndefined();
    expect(summitFrom(row({ 15: "99999", 16: "" }))!.elevationM).toBeUndefined();
  });

  it("skips a truncated row rather than reading shifted columns", () => {
    expect(summitFrom("1270000\tNandi Hills\t\t")).toBeNull();
  });
});

describe("build-geonames run (spec 18/41)", () => {
  it("writes every parsed summit and reports how many were scored", async () => {
    const io = memoryIO();
    const out = await runBuildGeonames(io, OUT, {
      lines: linesOf(row(), row({ 0: "2", 1: "Skandagiri", 4: "13.52", 5: "77.68" })),
      score: async (ss) => ss.forEach((s) => (s.discoveryScore = 0.5)),
      crossMatch: noop,
    });
    expect(out).toEqual({ summits: 2, scored: 2 });
    expect(JSON.parse(io.files.get(OUT)!)).toHaveLength(2);
  });

  it("leaves a summit the DEM could not resolve UNSCORED rather than guessing", async () => {
    const io = memoryIO();
    const out = await runBuildGeonames(io, OUT, {
      lines: linesOf(row()),
      score: noop, // the DEM resolved nothing
      crossMatch: noop,
    });
    expect(out.scored).toBe(0);
    expect(JSON.parse(io.files.get(OUT)!)[0].discoveryScore).toBeUndefined();
  });

  it("REFUSES a dump that parses to nothing — the tier would be erased", async () => {
    const io = memoryIO({ [OUT]: JSON.stringify([{ id: "previous" }]) });
    const before = io.files.get(OUT);
    await expect(
      runBuildGeonames(io, OUT, { lines: linesOf(), score: noop, crossMatch: noop }),
    ).rejects.toThrow(/refusing to write/);
    expect(io.files.get(OUT)).toBe(before);
  });

  it("refuses when every row is filtered out, not only when the dump is empty", async () => {
    const io = memoryIO({ [OUT]: JSON.stringify([{ id: "previous" }]) });
    const before = io.files.get(OUT);
    await expect(
      runBuildGeonames(io, OUT, {
        lines: linesOf(row({ 6: "P" }), row({ 6: "P" })),
        score: noop,
        crossMatch: noop,
      }),
    ).rejects.toThrow(/refusing to write/);
    expect(io.files.get(OUT)).toBe(before);
  });

  it("scores BEFORE cross-matching, so Wikidata can re-score what the DEM measured", async () => {
    const order: string[] = [];
    const io = memoryIO();
    await runBuildGeonames(io, OUT, {
      lines: linesOf(row()),
      score: async () => {
        order.push("score");
      },
      crossMatch: async () => {
        order.push("crossMatch");
      },
    });
    expect(order).toEqual(["score", "crossMatch"]);
  });
});

import { describe, it, expect } from "vitest";
import { runBuildGazetteer, gazetteerPathsFor, SERIES } from "./build-gazetteer";
import { memoryIO } from "./lib/buildIO";
import type { Trek } from "../src/lib/trek";

const ROOT = "/repo";
const P = gazetteerPathsFor(ROOT);

const trek = (over: Partial<Trek> & Pick<Trek, "id" | "name" | "lat" | "lng">): Trek => ({
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

const NANDI = trek({ id: "nandi", name: "Nandidurg", lat: 13.3702, lng: 77.6835 });

/**
 * A dictionary-style entry in the shape the parser expects: a headword, then
 * prose carrying an explicit coordinate. The matcher is coordinate-verified,
 * so the numbers must agree with the trek or nothing binds.
 */
const VOLUME = [
  "Nandidurg.—Hill fortress in the Kolar District of Mysore, situated in",
  "13° 22' N. and 77° 41' E., rising 4,851 feet above the sea. The fort was",
  "reduced by Lord Cornwallis in 1791 and is now a sanitarium.",
].join("\n");

const seeded = (treks: Trek[], manifest?: Record<string, string>) =>
  memoryIO({
    [P.treks]: JSON.stringify(treks),
    ...(manifest ? { [P.manifest]: JSON.stringify(manifest) } : {}),
  });

const deps = (text: string | undefined = VOLUME, ids = ["vol1"]) => ({
  discover: () => ids,
  volumeText: async () => text,
});

describe("build-gazetteer run (spec 41)", () => {
  it("bakes a coordinate-verified historical note and records provenance", async () => {
    const io = seeded([NANDI]);
    const out = await runBuildGazetteer(io, ROOT, deps());

    expect(out.entries).toBeGreaterThan(0);
    const written = JSON.parse(io.files.get(P.treks)!) as Trek[];
    const note = written[0].historicalNote;
    expect(note).toBeDefined();
    // The note must say WHICH gazetteer and WHEN — an unattributed historical
    // claim is worse than none (CON-DATA-001).
    expect(SERIES.map((s) => s.name)).toContain(note!.source);
    expect(note!.year).toBeGreaterThan(1800);
    expect(note!.url).toContain("archive.org");
  });

  it("REFUSES when nothing parses — that would strip every note in the dataset", async () => {
    const io = seeded([
      {
        ...NANDI,
        historicalNote: {
          text: "old",
          source: SERIES[0].name,
          year: 1908,
          url: "https://archive.org/x",
        },
      } as Trek,
    ]);
    const before = io.files.get(P.treks);
    await expect(runBuildGazetteer(io, ROOT, deps("nothing parseable here"))).rejects.toThrow(
      /refusing to write/,
    );
    expect(io.files.get(P.treks)).toBe(before);
  });

  it("refuses when every volume fails to download", async () => {
    const io = seeded([NANDI]);
    await expect(
      runBuildGazetteer(io, ROOT, { discover: () => ["vol1"], volumeText: async () => undefined }),
    ).rejects.toThrow(/refusing to write/);
  });

  it("drops a STALE note from our own series when the trek no longer matches", async () => {
    // Somewhere else entirely, so the coordinate check cannot bind it.
    const moved = trek({
      id: "nandi",
      name: "Nandidurg",
      lat: 28.6,
      lng: 77.2,
      historicalNote: {
        text: "previously matched",
        source: SERIES[0].name,
        year: 1908,
        url: "https://archive.org/x",
      },
    });
    const io = seeded([moved]);
    await runBuildGazetteer(io, ROOT, deps());
    expect((JSON.parse(io.files.get(P.treks)!) as Trek[])[0].historicalNote).toBeUndefined();
  });

  it("leaves a note from a DIFFERENT source alone — it is not ours to drop", async () => {
    const foreign = trek({
      id: "nandi",
      name: "Nandidurg",
      lat: 28.6,
      lng: 77.2,
      historicalNote: {
        text: "from somewhere else",
        source: "Some Other Book",
        year: 1950,
        url: "https://example.org/x",
      },
    });
    const io = seeded([foreign]);
    await runBuildGazetteer(io, ROOT, deps());
    expect((JSON.parse(io.files.get(P.treks)!) as Trek[])[0].historicalNote?.source).toBe(
      "Some Other Book",
    );
  });

  it("re-parses volumes recorded in the manifest, not only newly discovered ones", async () => {
    // Parsing is free once the text is local, so matches must accumulate
    // rather than fluctuate with whatever the search returned this time.
    const io = seeded([NANDI], { oldvol: SERIES[0].key });
    const asked: string[] = [];
    await runBuildGazetteer(io, ROOT, {
      discover: () => [],
      volumeText: async (id) => {
        asked.push(id);
        return VOLUME;
      },
    });
    expect(asked).toContain("oldvol");
  });

  it("counts a volume ONCE even when two series discover it", async () => {
    // Both series find the same volume ("Imperial provincial series Mysore"
    // matches both queries). Without the dedupe its entries are pushed twice
    // under two different source/year attributions, so a note can be dated to
    // the wrong gazetteer — the attribution failure the guard exists for.
    const io = seeded([NANDI]);
    const out = await runBuildGazetteer(io, ROOT, {
      discover: () => ["shared"],
      volumeText: async () => VOLUME,
    });
    const single = await runBuildGazetteer(seeded([NANDI]), ROOT, {
      discover: (series) => (series.key === SERIES[0].key ? ["only"] : []),
      volumeText: async () => VOLUME,
    });
    // Discovered by BOTH series, yet counted exactly as often as by one.
    expect(out.entries).toBe(single.entries);
    expect(JSON.parse(io.files.get(P.manifest)!).shared).toBe(SERIES[0].key);
  });

  it("records the manifest even when the run then REFUSES", async () => {
    // volumeText caches each downloaded volume to disk outside the io seam, so
    // a manifest that is not updated orphans those files: discoverVolumes
    // returns [] on a curl failure, so they would never be re-parsed.
    const io = seeded([NANDI]);
    await expect(
      runBuildGazetteer(io, ROOT, {
        discover: () => ["downloaded"],
        volumeText: async () => "nothing parseable",
      }),
    ).rejects.toThrow(/refusing to write/);
    expect(JSON.parse(io.files.get(P.manifest)!).downloaded).toBe(SERIES[0].key);
  });

  it("survives a corrupt manifest rather than refusing to start", async () => {
    const io = memoryIO({ [P.treks]: JSON.stringify([NANDI]), [P.manifest]: "{not json" });
    await expect(runBuildGazetteer(io, ROOT, deps())).resolves.toBeTruthy();
  });

  it("derives its paths and refuses a root that is not absolute (CON-PROC-006)", () => {
    expect(gazetteerPathsFor("/x").treks).toBe("/x/src/data/treks.json");
    for (const bad of ["relative", "", "/x/../y"]) {
      expect(() => gazetteerPathsFor(bad), JSON.stringify(bad)).toThrow(/refusing/);
    }
  });
});

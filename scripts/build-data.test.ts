import { describe, it, expect } from "vitest";
import { buildDataset, foldCurated, liveEnrichers, runBuildData } from "./build-data";
import { memoryIO } from "./lib/buildIO";
import { bestSeasonFrom, climateCellKey } from "../src/lib/climate";
import climateGrid from "../src/data/climate.json";
import { BANGALORE_ORIGIN, BANGALORE_SEED } from "./seed/bangalore";
import { validateTrek, type Trek } from "../src/lib/trek";

describe("buildDataset (end-to-end, no network)", () => {
  it("produces >=15 valid curated records from the seed alone", async () => {
    const treks = await buildDataset(BANGALORE_SEED, BANGALORE_ORIGIN);
    expect(treks.length).toBeGreaterThanOrEqual(15);
    for (const t of treks) {
      expect(validateTrek(t).ok).toBe(true);
      expect(t.tier).toBe("curated");
      expect(t.verified).toBe(true);
      expect(t.sources.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("applies the elevation fallback when the seed lacks one", async () => {
    const seed: Trek[] = [{ ...BANGALORE_SEED[0], id: "no-ele", elevationM: undefined }];
    const treks = await buildDataset(seed, BANGALORE_ORIGIN, {
      elevation: async () => 1234,
    });
    expect(treks[0].elevationM).toBe(1234);
  });

  it("merges enrichments (route + Commons image) below the manual seed", async () => {
    const seed: Trek[] = [{ ...BANGALORE_SEED[0], id: "enrich" }];
    const treks = await buildDataset(seed, BANGALORE_ORIGIN, {
      route: async () => ({ distanceKm: 62.1, driveTimeMin: 95 }),
      wiki: async () => ({
        summary: "ignored — seed already has highlights",
        image: { url: "https://upload.wikimedia.org/x.jpg", attribution: "Commons" },
      }),
    });
    expect(treks[0].distanceKm).toBe(62.1);
    expect(treks[0].driveTimeMin).toBe(95);
    expect(treks[0].image?.url).toContain("upload.wikimedia.org");
    // Manual highlights win over the wiki summary.
    expect(treks[0].highlights).toBe(BANGALORE_SEED[0].highlights);
  });

  it("fails the whole run if a record is invalid after merge", async () => {
    const bad: Trek[] = [{ ...BANGALORE_SEED[0], lat: 999 }];
    await expect(buildDataset(bad, BANGALORE_ORIGIN)).rejects.toThrow(/invalid/);
  });

  it("does not let a throwing enricher fail the build (best-effort)", async () => {
    const treks = await buildDataset([BANGALORE_SEED[0]], BANGALORE_ORIGIN, {
      route: async () => {
        throw new Error("network down");
      },
    });
    expect(treks).toHaveLength(1);
    expect(treks[0].distanceKm).toBeUndefined();
  });
});

describe("liveEnrichers wiring (spec 41)", () => {
  const seed = (over: Record<string, unknown> = {}) => ({
    id: "x",
    name: "X",
    lat: 13,
    lng: 77,
    sources: [] as string[],
    ...over,
  });

  it("does NOT spend a DEM lookup when the curated seed already has elevation", async () => {
    // Curated elevation is a human judgement; a derived signal must not
    // silently replace it (CON-DATA-004), and the lookup is wasted anyway.
    const e = liveEnrichers();
    await expect(e.elevation!(seed({ elevationM: 1478 }) as never)).resolves.toBeUndefined();
  });

  it("only looks for a wiki page when a source URL actually names one", async () => {
    const e = liveEnrichers();
    await expect(e.wiki!(seed({ sources: [] }) as never)).resolves.toBeUndefined();
    await expect(
      e.wiki!(seed({ sources: ["https://forest.example/page"] }) as never),
    ).resolves.toBeUndefined();
  });

  it("scrapes nothing when every source is Wikipedia", async () => {
    const e = liveEnrichers();
    await expect(
      e.scrape!(seed({ sources: ["https://en.wikipedia.org/wiki/X"] }) as never),
    ).resolves.toEqual({});
  });
});

describe("foldCurated — the weekly refresh must not wipe the dataset (spec 10)", () => {
  // Incident: from 2026-08-10 build:data overwrote treks.json with the 16
  // curated records, so build:discovery "preserved" enrichment from a file that
  // no longer held any, and the drift guard refused every weekly run.
  const prevCurated = {
    ...BANGALORE_SEED[0],
    landCover: "Tree cover",
    reliefM: 412,
    historicalNote: { text: "A fort.", source: "Gazetteer", year: 1908 },
    entryFee: "₹100",
  } as Trek;
  const discovery = {
    id: "gn-1",
    name: "A hill",
    lat: 13.1,
    lng: 77.2,
    tier: "discovery",
    sources: [],
    verified: false,
    landCover: "Grassland",
    bestSeason: "Oct–Feb",
  } as Trek;

  it("keeps every non-curated record exactly as it was", () => {
    const built = [{ ...BANGALORE_SEED[0] }];
    const out = foldCurated(built, [prevCurated, discovery]);
    expect(out).toHaveLength(2);
    expect(out.find((t) => t.id === "gn-1")).toEqual(discovery);
  });

  it("carries fields other tools baked onto a curated record", () => {
    const out = foldCurated([{ ...BANGALORE_SEED[0] }], [prevCurated]);
    expect(out[0].landCover).toBe("Tree cover");
    expect(out[0].reliefM).toBe(412);
    expect(out[0].historicalNote?.year).toBe(1908);
  });

  it("lets build-data's own fields win, and drops one the seed no longer has", () => {
    const built = [{ ...BANGALORE_SEED[0], highlights: "new", entryFee: undefined }];
    const out = foldCurated(built, [{ ...prevCurated, highlights: "old" }]);
    expect(out[0].highlights).toBe("new");
    expect(out[0].entryFee).toBeUndefined();
  });

  it("keeps an enriched field this run's source did not return (a failed lookup is not evidence)", () => {
    const image = { url: "https://upload.wikimedia.org/a.jpg", attribution: "Commons" };
    const prev = { ...prevCurated, image, distanceKm: 60, driveTimeMin: 70 };
    const out = foldCurated([{ ...BANGALORE_SEED[0] }], [prev]);
    expect(out[0].image).toEqual(image);
    // ...but a value this run did return replaces it.
    const other = { url: "https://upload.wikimedia.org/b.jpg", attribution: "Commons" };
    const fresh = foldCurated([{ ...BANGALORE_SEED[0], image: other }], [prev]);
    expect(fresh[0].image).toEqual(other);
  });

  it("drops a field this run decides when the seed and its enrichers no longer give it", () => {
    // permitRequired can be stated by a curator or scraped; either way this
    // run decides, so removing it from the seed removes it (a hand-kept list
    // of seed fields missed it, and it would have stuck forever).
    const out = foldCurated([{ ...BANGALORE_SEED[0] }], [{ ...prevCurated, permitRequired: true }]);
    expect(out[0].permitRequired).toBeUndefined();
  });

  it("carries nothing baked for the old point when a seed's coordinates are corrected", () => {
    const prev = { ...prevCurated, distanceKm: 60, image: { url: "u", attribution: "a" } };
    const moved = { ...BANGALORE_SEED[0], lat: BANGALORE_SEED[0].lat + 0.01 }; // ~1.1 km
    const out = foldCurated([moved], [prev]);
    expect(out[0].landCover).toBeUndefined();
    expect(out[0].distanceKm).toBeUndefined();
    expect(out[0].image).toBeUndefined();
  });

  it("drops the old article's photo when the seed cites a different article", () => {
    const prev = {
      ...prevCurated,
      sources: ["https://en.wikipedia.org/wiki/Ramadevarabetta_Vulture_Sanctuary"],
      image: { url: "u", attribution: "a" },
    };
    const built = {
      ...BANGALORE_SEED[0],
      sources: ["https://en.wikipedia.org/wiki/Ramadevarabetta"],
    };
    const out = foldCurated([built], [prev]);
    expect(out[0].image).toBeUndefined();
    expect(out[0].landCover).toBe("Tree cover"); // still the same place
  });

  it("keeps each record's key order, so a refresh does not rewrite unchanged records", () => {
    // mergeTrek emits enricher keys in its own order: put them BEFORE the seed
    // keys here, so a plain spread would visibly reorder the record.
    const { id, name, ...rest } = BANGALORE_SEED[0];
    const built = {
      image: { url: "u", attribution: "a" },
      distanceKm: 61,
      id,
      name,
      ...rest,
    } as Trek;
    const prev = { ...prevCurated, image: { url: "u", attribution: "a" }, distanceKm: 60 };
    const out = foldCurated([built], [prev]);
    const shared = Object.keys(prev).filter((k) => k in out[0]);
    expect(Object.keys(out[0]).slice(0, shared.length)).toEqual(shared);
  });

  it("drops a best season the curator deleted from the seed", () => {
    // bestSeason is decided by this run: the seed's, else this run's climate
    // derivation (buildDataset). A carried value would outlive the deletion.
    const { bestSeason: _drop, ...seed } = BANGALORE_SEED[0];
    void _drop;
    const out = foldCurated([seed as Trek], [{ ...prevCurated, bestSeason: "Jun–Sep" }]);
    expect(out[0].bestSeason).toBeUndefined();
  });

  it("does not carry a discovery score or estimated difficulty onto a promoted pin", () => {
    const pin = {
      ...discovery,
      id: BANGALORE_SEED[0].id,
      lat: BANGALORE_SEED[0].lat,
      lng: BANGALORE_SEED[0].lng,
      discoveryScore: 0.8,
      estimatedDifficulty: "Hard",
    } as Trek;
    const out = foldCurated([{ ...BANGALORE_SEED[0] }], [pin]);
    expect(out[0].discoveryScore).toBeUndefined();
    expect(out[0].estimatedDifficulty).toBeUndefined();
  });

  it("does not carry a road distance this run did not measure", () => {
    // It is a fact about the route from the origin, not about the summit.
    const out = foldCurated(
      [{ ...BANGALORE_SEED[0] }],
      [{ ...prevCurated, distanceKm: 60, driveTimeMin: 70 }],
    );
    expect(out[0].distanceKm).toBeUndefined();
    expect(out[0].driveTimeMin).toBeUndefined();
  });

  it("takes over a discovery pin a new seed promotes, instead of duplicating its id", () => {
    const pin = {
      ...discovery,
      id: BANGALORE_SEED[0].id,
      lat: BANGALORE_SEED[0].lat,
      lng: BANGALORE_SEED[0].lng,
    };
    const out = foldCurated([{ ...BANGALORE_SEED[0] }], [pin]);
    expect(out.filter((t) => t.id === pin.id)).toHaveLength(1);
    expect(out[0].tier).toBe("curated");
    expect(out[0].landCover).toBe("Grassland"); // baked for the same place
  });

  it("treats a previous record with no sources as citing different ones, without crashing", () => {
    const broken = { ...prevCurated, sources: undefined, image: { url: "u", attribution: "a" } };
    const out = foldCurated([{ ...BANGALORE_SEED[0] }], [broken as unknown as Trek]);
    expect(out[0].image).toBeUndefined();
  });

  it("drops a curated record whose seed was removed, and adds a new one", () => {
    const gone = { ...prevCurated, id: "removed-seed" };
    const out = foldCurated([{ ...BANGALORE_SEED[1] }], [gone, discovery]);
    expect(out.map((t) => t.id).sort()).toEqual([BANGALORE_SEED[1].id, "gn-1"].sort());
  });

  it("starts from the built records alone when there is no previous dataset", () => {
    expect(foldCurated([{ ...BANGALORE_SEED[0] }], [])).toHaveLength(1);
  });
});

describe("buildDataset — a seed with no best season gets one from the committed rainfall", () => {
  it("derives it this run, the way build:climate does, and lets the seed's own win", async () => {
    const { bestSeason: _drop, ...bare } = BANGALORE_SEED[0];
    void _drop;
    const season = () => "Nov–Feb";
    const [derived] = await buildDataset([bare as Trek], BANGALORE_ORIGIN, { season });
    expect(derived.bestSeason).toBe("Nov–Feb");
    const [stated] = await buildDataset([BANGALORE_SEED[0]], BANGALORE_ORIGIN, { season });
    expect(stated.bestSeason).toBe(BANGALORE_SEED[0].bestSeason);
  });

  it("the live enricher reads the committed climate grid", () => {
    const e = liveEnrichers();
    // Skandagiri's cell is sampled (spec 20): the same season build:climate
    // would bake from that cell.
    const t = BANGALORE_SEED[0];
    const monthly = (climateGrid as Record<string, number[]>)[climateCellKey(t.lat, t.lng)];
    expect(monthly).toBeDefined();
    expect(e.season!({ ...t })).toBe(bestSeasonFrom(monthly));
    expect(e.season!({ ...t, lat: 0, lng: 0 })).toBeUndefined(); // no cell there
  });
});

describe("runBuildData — what build:data actually writes (spec 10)", () => {
  // The bug lived in main()'s write, not in a helper: test the run end to end.
  it("folds into the committed file, keeping every discovery record", async () => {
    const file = "/repo/src/data/treks.json";
    const discovery = {
      id: "gn-1",
      name: "A hill",
      lat: 13.1,
      lng: 77.2,
      tier: "discovery",
      sources: [],
      verified: false,
      landCover: "Grassland",
    };
    const io = memoryIO({ [file]: JSON.stringify([discovery]) });
    const r = await runBuildData(io, file, BANGALORE_SEED, BANGALORE_ORIGIN, {});
    const written = JSON.parse(io.files.get(file)!) as Trek[];
    expect(r.total).toBe(BANGALORE_SEED.length + 1);
    expect(written.find((t) => t.id === "gn-1")).toEqual(discovery);
  });

  it("refuses, by name, a committed file that is not an array", async () => {
    const file = "/repo/src/data/treks.json";
    const io = memoryIO({ [file]: "{}" });
    await expect(runBuildData(io, file, BANGALORE_SEED, BANGALORE_ORIGIN, {})).rejects.toThrow(
      /not an array of treks/,
    );
  });

  it("refuses, by name, a committed file with an entry that is not a trek", async () => {
    const file = "/repo/src/data/treks.json";
    for (const [body, why] of [
      ["[null]", /has an entry at index 0 that is not a trek with an id/],
      ['[{"name":"x"}]', /has an entry at index 0 that is not a trek with an id/],
      ["[{", /is not valid JSON/],
    ] as const) {
      const io = memoryIO({ [file]: body });
      let enriched = false;
      const wiki = async () => {
        enriched = true;
        return {};
      };
      await expect(
        runBuildData(io, file, BANGALORE_SEED, BANGALORE_ORIGIN, { wiki }),
        body,
      ).rejects.toThrow(new RegExp(`${file} .*${why.source}`));
      // Refused before the slow, rate-limited network work.
      expect(enriched, body).toBe(false);
    }
  });

  it("keeps a curated photo when this run's lookup came back without one", async () => {
    // Six photos were lost this way when the source changed shape (spec 10):
    // an answer without a photo is not evidence that it is gone.
    const file = "/repo/src/data/treks.json";
    const seed = BANGALORE_SEED[0];
    const image = { url: "https://upload.wikimedia.org/a.jpg", attribution: "Commons" };
    // A lookup that answered without one (as a disambiguation page does), or failed.
    for (const wiki of [
      async () => ({}),
      async () => {
        throw new Error("503");
      },
    ]) {
      const io = memoryIO({ [file]: JSON.stringify([{ ...seed, image }]) });
      await runBuildData(io, file, [seed], BANGALORE_ORIGIN, { wiki });
      expect((JSON.parse(io.files.get(file)!) as Trek[])[0].image).toEqual(image);
    }
  });

  it("refuses up front only the records the fold keeps exactly", async () => {
    const file = "/repo/src/data/treks.json";
    const pin = {
      id: "gn-1",
      name: "A hill",
      lat: 13.1,
      lng: 77.2,
      tier: "discovery",
      sources: [],
      verified: false,
    };
    // A kept record (a discovery pin no seed rebuilds) that is invalid: refused by index, early.
    let enriched = false;
    const wiki = async () => {
      enriched = true;
      return {};
    };
    const bad = memoryIO({ [file]: JSON.stringify([{ ...pin, lat: "x" }]) });
    await expect(
      runBuildData(bad, file, BANGALORE_SEED, BANGALORE_ORIGIN, { wiki }),
    ).rejects.toThrow(/has an invalid record at index 0: .*lat/);
    expect(enriched).toBe(false);
    // The same invalid record, promoted by a seed with its id, is replaced, not refused.
    const seed = BANGALORE_SEED[0];
    const promoted = memoryIO({ [file]: JSON.stringify([{ ...pin, id: seed.id, lat: "x" }]) });
    await runBuildData(promoted, file, [seed], BANGALORE_ORIGIN, {});
    expect((JSON.parse(promoted.files.get(file)!) as Trek[])[0].lat).toBe(seed.lat);
    // An invalid curated record whose seed is gone is dropped, not refused.
    const gone = { ...pin, id: "gone", tier: "curated", lat: "x" };
    const dropped = memoryIO({ [file]: JSON.stringify([gone]) });
    await runBuildData(dropped, file, [seed], BANGALORE_ORIGIN, {});
    expect((JSON.parse(dropped.files.get(file)!) as Trek[]).map((t) => t.id)).toEqual([seed.id]);
  });

  it("refuses a carried photo a tightened rule rejects, naming it, and writes nothing", async () => {
    // Not rebuilt, so not repaired: the output validation is its gate.
    const file = "/repo/src/data/treks.json";
    const seed = BANGALORE_SEED[0];
    const committed = JSON.stringify([{ ...seed, image: { url: "", attribution: "" } }]);
    const io = memoryIO({ [file]: committed });
    await expect(runBuildData(io, file, [seed], BANGALORE_ORIGIN, {})).rejects.toThrow(
      new RegExp(
        `folding into ${file} gives an invalid dataset, nothing written: .*${seed.id}.*image`,
      ),
    );
    expect(io.files.get(file)).toBe(committed);
  });

  it("repairs a committed curated record whose rebuilt fields a tightened rule rejects", async () => {
    // The fold replaces a rebuilt record's `run` fields, so build:data fixes
    // one the validator now refuses there instead of refusing the file.
    // (A carried place field or photo is not rebuilt, so it is not repaired.)
    const file = "/repo/src/data/treks.json";
    const seed = BANGALORE_SEED[0];
    const io = memoryIO({ [file]: JSON.stringify([{ ...seed, lat: "not a number" }]) });
    await runBuildData(io, file, [seed], BANGALORE_ORIGIN, {});
    expect((JSON.parse(io.files.get(file)!) as Trek[])[0].lat).toBe(seed.lat);
  });

  it("writes the curated records alone when there is no file yet", async () => {
    const file = "/repo/src/data/treks.json";
    const io = memoryIO({});
    await runBuildData(io, file, BANGALORE_SEED, BANGALORE_ORIGIN, {});
    expect(JSON.parse(io.files.get(file)!)).toHaveLength(BANGALORE_SEED.length);
  });
});

import { describe, it, expect } from "vitest";
import { buildDataset, foldCurated, liveEnrichers } from "./build-data";
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
    expect(out[0].distanceKm).toBe(60);
    // ...but a value this run did return replaces it.
    const fresh = foldCurated([{ ...BANGALORE_SEED[0], distanceKm: 61 }], [prev]);
    expect(fresh[0].distanceKm).toBe(61);
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

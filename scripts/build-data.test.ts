import { describe, it, expect } from "vitest";
import { buildDataset, liveEnrichers } from "./build-data";
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

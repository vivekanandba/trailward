import { describe, it, expect } from "vitest";
import { slugFor, qualifies, qualifyingTreks, slugMap } from "./pages";
import type { Trek } from "../../src/lib/trek";

const mk = (over: Partial<Trek> & Pick<Trek, "id" | "name">): Trek => ({
  lat: 13,
  lng: 77,
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

describe("slugFor (spec 35)", () => {
  it("is URL-safe, lowercase, and transliterates diacritics", () => {
    expect(slugFor(mk({ id: "gn-1", name: "Kumāra Parvatha" }))).toBe("kumara-parvatha");
    expect(slugFor(mk({ id: "gn-2", name: "Nandi Hills, Karnataka" }))).toBe(
      "nandi-hills-karnataka",
    );
    expect(slugFor(mk({ id: "skandagiri", name: "Skandagiri" }))).toBe("skandagiri");
  });

  it("is stable for the same record", () => {
    const t = mk({ id: "gn-9", name: "Savandurga" });
    expect(slugFor(t)).toBe(slugFor(t));
  });

  it("falls back to the id when a name yields nothing sluggable", () => {
    expect(slugFor(mk({ id: "gn-77", name: "???" }))).toBe("gn-77");
  });
});

describe("qualifies (spec 35 — quality over volume)", () => {
  it("accepts curated records", () => {
    expect(qualifies(mk({ id: "a", name: "A", tier: "curated" }))).toBe(true);
  });

  it("accepts records carrying real prose or media", () => {
    expect(qualifies(mk({ id: "b", name: "B", highlights: "A fine ridge walk." }))).toBe(true);
    expect(
      qualifies(
        mk({
          id: "c",
          name: "C",
          historicalNote: { text: "Noted in 1908.", source: "Imperial Gazetteer", year: 1908 },
        }),
      ),
    ).toBe(true);
    expect(
      qualifies(mk({ id: "d", name: "D", image: { url: "https://x/y.jpg", attribution: "z" } })),
    ).toBe(true);
  });

  it("REJECTS Unnamed records however well scored — nothing to rank for", () => {
    expect(
      qualifies(
        mk({
          id: "d12-1",
          name: "Unnamed peak (~912 m)",
          highlights: "x",
          discoveryScore: 0.99,
          reliefM: 900,
        }),
      ),
    ).toBe(false);
  });

  it("rejects a bare named record with no prose, media or standing", () => {
    expect(qualifies(mk({ id: "gn-5", name: "Some Hill" }))).toBe(false);
  });
});

describe("qualifyingTreks", () => {
  const bare = (i: number, over: Partial<Trek> = {}) =>
    mk({ id: `gn-${i}`, name: `Hill ${i}`, ...over });

  it("adds the top-ranked named summits per 1° cell, spreading coverage", () => {
    const treks: Trek[] = [
      // Same cell: only the strongest should be topped up.
      bare(1, { lat: 13.1, lng: 77.1, discoveryScore: 0.9 }),
      bare(2, { lat: 13.2, lng: 77.2, discoveryScore: 0.2 }),
      // A different cell gets its own representative.
      bare(3, { lat: 18.5, lng: 73.9, discoveryScore: 0.3 }),
    ];
    const ids = qualifyingTreks(treks, { topPerCell: 1 }).map((t) => t.id);
    expect(ids).toContain("gn-1");
    expect(ids).toContain("gn-3");
    expect(ids).not.toContain("gn-2");
  });

  it("never emits duplicate slugs — a silently overwritten page is a lost page", () => {
    const treks: Trek[] = [
      mk({ id: "gn-10", name: "Nandi Hills", tier: "curated" }),
      mk({ id: "gn-11", name: "Nandi Hills", tier: "curated", lat: 20, lng: 80 }),
    ];
    const out = qualifyingTreks(treks);
    const slugs = [...slugMap(out).values()];
    expect(out).toHaveLength(2);
    expect(new Set(slugs).size).toBe(2); // disambiguated, not dropped
    expect(slugs).toContain("nandi-hills");
    expect(slugs).toContain("nandi-hills-gn-11");
  });

  it("slugMap is pure — repeated calls give identical results", () => {
    const treks = [
      mk({ id: "gn-10", name: "Nandi Hills", tier: "curated" }),
      mk({ id: "gn-11", name: "Nandi Hills", tier: "curated" }),
    ];
    expect([...slugMap(treks).entries()]).toEqual([...slugMap(treks).entries()]);
  });

  it("is deterministic: same input, same order", () => {
    const treks = [bare(1, { tier: "curated" }), bare(2, { tier: "curated" })];
    expect(qualifyingTreks(treks).map((t) => t.id)).toEqual(
      qualifyingTreks(treks).map((t) => t.id),
    );
  });
});

import { describe, it, expect } from "vitest";
import { searchIndex, type IndexEntry } from "./search";

const entry = (over: Partial<IndexEntry> & Pick<IndexEntry, "id" | "name">): IndexEntry => ({
  lat: 13,
  lng: 77,
  ...over,
});

const INDEX: IndexEntry[] = [
  entry({ id: "a", name: "Kumara Parvatha", score: 0.8 }),
  entry({ id: "b", name: "Parvatha Malai", score: 0.5 }),
  entry({ id: "c", name: "Skandagiri", alt: ["Kalavara Durga"], score: 0.9 }),
  entry({ id: "d", name: "Nandi Hills", score: 0.7 }),
];

describe("searchIndex (spec 38)", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchIndex(INDEX, "")).toEqual([]);
    expect(searchIndex(INDEX, "   ")).toEqual([]);
  });

  it("ranks a prefix match above a mid-string match", () => {
    const ids = searchIndex(INDEX, "parvatha").map((e) => e.id);
    // "Parvatha Malai" starts with the query; "Kumara Parvatha" merely contains it.
    expect(ids[0]).toBe("b");
    expect(ids).toContain("a");
  });

  it("matches alternate names", () => {
    expect(searchIndex(INDEX, "kalavara").map((e) => e.id)).toEqual(["c"]);
  });

  it("is case- and diacritic-insensitive", () => {
    expect(searchIndex(INDEX, "KUMARA").map((e) => e.id)).toContain("a");
    expect(searchIndex([entry({ id: "x", name: "Kumāra" })], "kumara").map((e) => e.id)).toEqual([
      "x",
    ]);
  });

  it("breaks ties by terrain score, strongest first", () => {
    const ids = searchIndex(
      [
        entry({ id: "lo", name: "Hill X", score: 0.1 }),
        entry({ id: "hi", name: "Hill Y", score: 0.9 }),
      ],
      "hill",
    ).map((e) => e.id);
    expect(ids).toEqual(["hi", "lo"]);
  });

  it("caps the result count", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ id: `n${i}`, name: `Hill ${i}` }));
    expect(searchIndex(many, "hill")).toHaveLength(8);
    expect(searchIndex(many, "hill", 3)).toHaveLength(3);
  });

  it("never surfaces an Unnamed pin — they have nothing to search for", () => {
    const withUnnamed = [...INDEX, entry({ id: "u", name: "Unnamed peak (~912 m)" })];
    expect(searchIndex(withUnnamed, "unnamed")).toEqual([]);
    expect(searchIndex(withUnnamed, "peak")).toEqual([]);
  });
});

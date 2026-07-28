import { describe, it, expect } from "vitest";
import { parseWikidataMatches, parseHeritageSites } from "./wikidata";

const sparql = (bindings: Record<string, { value: string }>[]): string =>
  JSON.stringify({ results: { bindings } });

describe("parseWikidataMatches", () => {
  it("keys matches by GeoNames ID, capturing article + image presence", () => {
    const json = sparql([
      {
        geonames: { value: "1268747" },
        article: { value: "https://en.wikipedia.org/wiki/Kabbaldurga" },
      },
      {
        geonames: { value: "1255954" },
        image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/x.jpg" },
      },
    ]);
    const m = parseWikidataMatches(json);
    expect(m.get("1268747")).toEqual({ hasArticle: true, image: undefined });
    expect(m.get("1255954")?.image).toContain("FilePath");
    expect(m.get("1255954")?.hasArticle).toBe(false);
  });

  it("merges duplicate rows for the same summit (article in one, image in another)", () => {
    const json = sparql([
      { geonames: { value: "42" }, article: { value: "https://en.wikipedia.org/wiki/A" } },
      { geonames: { value: "42" }, image: { value: "http://commons/FilePath/a.jpg" } },
    ]);
    const m = parseWikidataMatches(json);
    expect(m.get("42")).toEqual({ hasArticle: true, image: "http://commons/FilePath/a.jpg" });
  });

  it("ignores rows without a GeoNames ID and tolerates empty results", () => {
    expect(parseWikidataMatches(sparql([{ image: { value: "x" } }])).size).toBe(0);
    expect(parseWikidataMatches(JSON.stringify({})).size).toBe(0);
  });
});

describe("parseHeritageSites (spec 24)", () => {
  it("extracts coordinates + designation labels", () => {
    const json = JSON.stringify({
      results: {
        bindings: [
          {
            coord: { value: "Point(77.5758 13.3702)" },
            statusLabel: { value: "Monument of National Importance" },
          },
          { coord: { value: "garbage" }, statusLabel: { value: "State Protected Monument" } },
          { statusLabel: { value: "no coord" } },
        ],
      },
    });
    const sites = parseHeritageSites(json);
    expect(sites).toEqual([
      { lat: 13.3702, lng: 77.5758, status: "Monument of National Importance" },
    ]);
  });

  it("tolerates empty results", () => {
    expect(parseHeritageSites(JSON.stringify({}))).toEqual([]);
  });
});

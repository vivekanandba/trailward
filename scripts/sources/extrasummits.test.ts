import { describe, it, expect } from "vitest";
import { parseOsmSummits, parseWikidataSummits } from "./extrasummits";
import { dedupeExtras } from "../build-summits-extra";

describe("parseOsmSummits (spec 31)", () => {
  it("keeps named nodes with a plausible elevation, drops the rest", () => {
    const json = {
      elements: [
        { type: "node", id: 1, lat: 12.5, lon: 77.2, tags: { name: "Bilikal Betta", ele: "1273" } },
        { type: "node", id: 2, lat: 12.6, lon: 77.3, tags: { ele: "900" } }, // unnamed
        { type: "node", id: 3, lat: 12.7, lon: 77.4, tags: { name: "Junk Ele", ele: "12000ft" } },
        { type: "way", id: 4, tags: { name: "A ridge way" } }, // not a node
      ],
    };
    const out = parseOsmSummits(json);
    expect(out.map((s) => s.fullId)).toEqual(["osmx-1", "osmx-3"]);
    expect(out[0]).toMatchObject({ name: "Bilikal Betta", elevationM: 1273 });
    expect(out[1].elevationM).toBeUndefined(); // "12000ft" is not a metres number
    expect(out[0].sourceUrl).toBe("https://www.openstreetmap.org/node/1");
  });

  it("returns [] on a malformed response", () => {
    expect(parseOsmSummits({ remark: "timeout" })).toEqual([]);
  });
});

describe("parseWikidataSummits (spec 31)", () => {
  it("parses WKT coordinates (lng-first) and skips label-less items", () => {
    const json = {
      results: {
        bindings: [
          {
            item: { value: "http://www.wikidata.org/entity/Q123" },
            itemLabel: { value: "Kumara Parvatha" },
            coord: { value: "Point(75.6 12.66)" },
            ele: { value: "1712" },
          },
          {
            item: { value: "http://www.wikidata.org/entity/Q456" },
            itemLabel: { value: "Q456" }, // bare Q-id = no real label
            coord: { value: "Point(76 13)" },
          },
        ],
      },
    };
    const out = parseWikidataSummits(json);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      fullId: "wd-Q123",
      name: "Kumara Parvatha",
      lat: 12.66,
      lng: 75.6,
      elevationM: 1712,
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    });
  });
});

describe("dedupeExtras", () => {
  it("keeps the first summit in a ~250 m cell and later ones elsewhere", () => {
    const mk = (fullId: string, lat: number, lng: number) =>
      ({ id: fullId, fullId, name: "x", lat, lng, sourceUrl: "u" }) as never;
    const out = dedupeExtras([
      mk("osmx-1", 12.5, 77.2),
      mk("wd-Q1", 12.5001, 77.2001), // same summit from Wikidata — dropped
      mk("wd-Q2", 12.55, 77.25), // far away — kept
    ]);
    expect(out.map((s: { fullId: string }) => s.fullId)).toEqual(["osmx-1", "wd-Q2"]);
  });

  it("drops repeated ids even when their coordinates disagree (multi-P625 items)", () => {
    const mk = (fullId: string, lat: number, lng: number) =>
      ({ id: fullId, fullId, name: "x", lat, lng, sourceUrl: "u" }) as never;
    const out = dedupeExtras([mk("wd-Q9", 12.5, 77.2), mk("wd-Q9", 12.9, 77.9)]);
    expect(out).toHaveLength(1);
  });
});

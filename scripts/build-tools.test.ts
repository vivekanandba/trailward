import { describe, it, expect } from "vitest";
import { pickVolumes } from "./build-gazetteer";
import { pickTargets, matchHeritage } from "./build-hillfeatures";
import { cellsFor } from "./build-climate";
import type { Trek } from "../src/lib/trek";
import { climateCellKey } from "../src/lib/climate";

// Pure selection helpers of the hand-run build tools. The tools' network shells
// are exercised by running them; these lock in *what they choose to fetch*,
// which is where the cost and the correctness live.

describe("pickVolumes (gazetteer)", () => {
  it("prefers southern provincial series and alphabetical spans", () => {
    const docs = [
      { identifier: "old", title: "Imperial Gazetteer Of India Vol Ii(1885)" },
      { identifier: "madras", title: "Imperial Gazetteer of India Provincial Series Madras" },
      { identifier: "span", title: "The Imperial Gazetteer Of India Vol-xx Pardi To Pusad" },
    ];
    expect(pickVolumes(docs)[0]).toBe("madras");
    expect(pickVolumes(docs).indexOf("span")).toBeLessThan(pickVolumes(docs).indexOf("old"));
  });

  it("drops entries missing an identifier or title, and honours the cap", () => {
    const docs = [
      { identifier: "a", title: "Imperial Gazetteer of India Vol 1" },
      { identifier: "b" },
      { title: "no id" },
    ];
    expect(pickVolumes(docs)).toEqual(["a"]);
    expect(
      pickVolumes(
        [...Array(30)].map((_, i) => ({ identifier: `v${i}`, title: "Vol" })),
        5,
      ),
    ).toHaveLength(5);
  });
});

const mk = (over: Partial<Trek> & Pick<Trek, "id">): Trek => ({
  name: over.id,
  lat: 13,
  lng: 77,
  cityId: "bangalore",
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

describe("pickTargets (hill features)", () => {
  it("always includes curated treks and anything with a trail or POIs", () => {
    const treks = [
      mk({ id: "cur", tier: "curated", verified: true, sources: ["https://x"] }),
      mk({ id: "withPois", pois: [{ kind: "parking", lat: 13, lng: 77, distM: 10 }] }),
      mk({ id: "plain" }),
    ];
    const ids = pickTargets(treks, 0).map((t) => t.id);
    expect(ids).toContain("cur");
    expect(ids).toContain("withPois");
    expect(ids).not.toContain("plain");
  });

  it("adds the top-scoring discovery peaks per region, without duplicating", () => {
    const treks = [
      mk({ id: "hi", discoveryScore: 0.9 }),
      mk({ id: "lo", discoveryScore: 0.1 }),
      mk({ id: "other", cityId: "pune", discoveryScore: 0.5 }),
    ];
    const ids = pickTargets(treks, 1).map((t) => t.id);
    expect(ids).toContain("hi"); // top of bangalore
    expect(ids).toContain("other"); // top of its own region
    expect(ids).not.toContain("lo");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cellsFor (climate)", () => {
  it("returns one sample point per distinct grid cell, at the cell centre", () => {
    const treks = [
      mk({ id: "a", lat: 13.01, lng: 77.01 }),
      mk({ id: "b", lat: 13.02, lng: 77.02 }),
    ];
    const cells = cellsFor(treks);
    expect(cells).toHaveLength(1); // same 0.25° cell
    expect(cells[0].key).toBe(climateCellKey(13.01, 77.01));
    // Centre of the cell, so the sample represents the whole cell.
    expect(cells[0].lat).toBeCloseTo(13.125, 3);
    expect(cells[0].lng).toBeCloseTo(77.125, 3);
  });

  it("separates treks in different cells", () => {
    expect(
      cellsFor([mk({ id: "a", lat: 13, lng: 77 }), mk({ id: "b", lat: 14, lng: 78 })]),
    ).toHaveLength(2);
  });
});

describe("pickVolumes tolerates archive.org's multi-valued title field", () => {
  it("accepts a title returned as an array of strings", () => {
    const docs = [
      { identifier: "arr", title: ["Imperial Gazetteer of India", "Provincial Series Madras"] },
      { identifier: "str", title: "Imperial Gazetteer Of India Vol Ii(1885)" },
    ];
    // The array-titled Madras volume must both survive and outrank the 1885 one.
    expect(pickVolumes(docs)).toEqual(["arr", "str"]);
  });

  it("ignores a title of an unexpected type instead of throwing", () => {
    expect(() => pickVolumes([{ identifier: "x", title: 42 }])).not.toThrow();
    expect(pickVolumes([{ identifier: "x", title: 42 }])).toEqual([]);
  });
});

describe("matchHeritage (spec 24)", () => {
  const t = mk({ id: "x", lat: 13.3702, lng: 77.5758 });
  it("matches the nearest designation within 600 m and rejects farther ones", () => {
    expect(
      matchHeritage(t, [{ lat: 13.3705, lng: 77.576, status: "Monument of National Importance" }]),
    ).toBe("Monument of National Importance");
    expect(matchHeritage(t, [{ lat: 13.4, lng: 77.6, status: "Too Far" }])).toBeUndefined();
  });
});

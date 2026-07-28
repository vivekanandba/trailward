import { describe, it, expect, vi } from "vitest";
import {
  parseWildlife,
  parseVoyage,
  parseCommonsPhoto,
  parseWikiTitle,
  parseWikiSummary,
  parseNominatimTown,
  fetchLiveEnrichment,
} from "./enrich";

describe("parseCommonsPhoto", () => {
  it("takes the first page's image, preferring the thumb URL, with a clean credit", () => {
    const img = parseCommonsPhoto({
      query: {
        pages: {
          "1": {
            imageinfo: [
              {
                url: "https://upload.wikimedia.org/full.jpg",
                thumburl: "https://upload.wikimedia.org/thumb.jpg",
                descriptionurl: "https://commons.wikimedia.org/wiki/File:x.jpg",
                extmetadata: { Artist: { value: '<a href="/wiki/User:Jo">Jo</a>' } },
              },
            ],
          },
        },
      },
    });
    expect(img?.url).toBe("https://upload.wikimedia.org/thumb.jpg");
    expect(img?.attribution).toBe("Jo https://commons.wikimedia.org/wiki/File:x.jpg");
  });

  it("falls back to 'Wikimedia Commons' when there's no artist, and skips pages without imageinfo", () => {
    const img = parseCommonsPhoto({
      query: { pages: { "1": { title: "no image" }, "2": { imageinfo: [{ url: "u" }] } } },
    });
    expect(img?.url).toBe("u");
    expect(img?.attribution).toBe("Wikimedia Commons");
  });

  it("returns undefined with no pages", () => {
    expect(parseCommonsPhoto({ query: {} })).toBeUndefined();
  });
});

describe("parseWikiTitle / parseWikiSummary", () => {
  it("reads the nearest article title", () => {
    expect(parseWikiTitle({ query: { geosearch: [{ title: "Skandagiri" }] } })).toBe("Skandagiri");
    expect(parseWikiTitle({ query: { geosearch: [] } })).toBeUndefined();
  });

  it("returns a usable summary but drops disambiguation pages", () => {
    expect(parseWikiSummary({ extract: "A hill fort.", type: "standard" })).toBe("A hill fort.");
    expect(
      parseWikiSummary({ extract: "Foo may refer to", type: "disambiguation" }),
    ).toBeUndefined();
  });

  it("truncates a very long extract", () => {
    const out = parseWikiSummary({ extract: "x".repeat(600), type: "standard" })!;
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("parseNominatimTown", () => {
  it("prefers town → village → city …", () => {
    expect(parseNominatimTown({ address: { city: "Bengaluru", county: "X" } })).toBe("Bengaluru");
    expect(parseNominatimTown({ address: { village: "Nandi" } })).toBe("Nandi");
    expect(parseNominatimTown({})).toBeUndefined();
  });
});

describe("fetchLiveEnrichment", () => {
  it("combines the three sources, chaining the summary off the article title", async () => {
    const getJson = vi.fn(async (url: string) => {
      if (url.includes("commons.wikimedia.org"))
        return { query: { pages: { "1": { imageinfo: [{ url: "photo.jpg" }] } } } };
      if (url.includes("list=geosearch"))
        return { query: { geosearch: [{ title: "Nandi Hills" }] } };
      if (url.includes("en.wikipedia.org/api/rest_v1/page/summary/"))
        return { extract: "A popular hill station.", type: "standard" };
      if (url.includes("nominatim")) return { address: { town: "Nandi" } };
      if (url.includes("api.inaturalist.org"))
        return {
          total_results: 120,
          results: [{ taxon: { name: "Macaca radiata", preferred_common_name: "Bonnet Macaque" } }],
        };
      if (url.includes("wikivoyage.org/w/api.php"))
        return { query: { geosearch: [{ title: "Nandi Hills" }] } };
      if (url.includes("wikivoyage.org/api/rest_v1"))
        return { extract: "A hill station near Bangalore.", type: "standard" };
      return {};
    });
    const out = await fetchLiveEnrichment(13.37, 77.68, getJson);
    expect(out.image?.url).toBe("photo.jpg");
    expect(out.highlights).toBe("A popular hill station.");
    expect(out.nearestTown).toBe("Nandi");
    expect(out.wildlife).toEqual({ records: 120, species: [{ name: "Bonnet Macaque" }] });
    expect(out.voyage).toEqual({
      title: "Nandi Hills",
      url: "https://en.wikivoyage.org/wiki/Nandi_Hills",
      summary: "A hill station near Bangalore.",
    });
    // Summary URL was derived from the geosearch title.
    expect(getJson).toHaveBeenCalledWith(expect.stringContaining("summary/Nandi%20Hills"));
  });

  it("degrades to empty fields when a source fails or is empty", async () => {
    const getJson = vi.fn(async (url: string) => {
      if (url.includes("nominatim")) return { address: { village: "Solo" } };
      throw new Error("network");
    });
    const out = await fetchLiveEnrichment(1, 2, getJson);
    expect(out).toEqual({
      image: undefined,
      highlights: undefined,
      nearestTown: "Solo",
      wildlife: undefined,
      voyage: undefined,
    });
  });
});

describe("parseWildlife (iNaturalist)", () => {
  const obs = (sci: string, common?: string, photo?: string) => ({
    taxon: {
      name: sci,
      ...(common ? { preferred_common_name: common } : {}),
      ...(photo
        ? { default_photo: { square_url: photo, attribution: "(c) someone, CC BY-NC" } }
        : {}),
    },
  });

  it("prefers common names and carries the CC photo + attribution", () => {
    const w = parseWildlife({
      total_results: 494,
      results: [
        obs("Lycodon deccanensis", "Deccan Wolf Snake", "https://inat/sq.jpg"),
        obs("Lycodon deccanensis", "Deccan Wolf Snake", "https://inat/sq.jpg"), // dup collapses
        obs("Pellorneum ruficeps", undefined, undefined), // no common name → binomial
      ],
    })!;
    expect(w.records).toBe(494);
    expect(w.species).toEqual([
      {
        name: "Deccan Wolf Snake",
        photo: "https://inat/sq.jpg",
        attribution: "(c) someone, CC BY-NC",
      },
      { name: "Pellorneum ruficeps" },
    ]);
  });

  it("caps the list and tolerates junk input", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      obs(`Genus sp${i}`, `Common ${i}`, undefined),
    );
    expect(parseWildlife({ total_results: 20, results: many }, 4)!.species).toHaveLength(4);
    expect(parseWildlife({})).toBeUndefined();
    expect(parseWildlife({ total_results: 0, results: [] })).toBeUndefined();
  });
});

describe("parseVoyage", () => {
  it("builds the article stub from a geosearch hit", () => {
    const v = parseVoyage({ query: { geosearch: [{ title: "Nandi Hills" }] } });
    expect(v).toEqual({
      title: "Nandi Hills",
      url: "https://en.wikivoyage.org/wiki/Nandi_Hills",
    });
  });

  it("returns undefined when nothing is nearby", () => {
    expect(parseVoyage({ query: { geosearch: [] } })).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { collectUrls, sampleByHost } from "./check-links";
import type { Trek } from "../src/lib/trek";

const trek = (over: Partial<Trek> & Pick<Trek, "id">): Trek => ({
  name: over.id,
  lat: 13,
  lng: 77,
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

describe("collectUrls (spec 37/40)", () => {
  it("gathers source, image and gazetteer URLs, de-duplicated", () => {
    const urls = collectUrls(
      [
        trek({ id: "a", sources: ["https://en.wikipedia.org/wiki/X", "https://geonames.org/1"] }),
        trek({ id: "b", sources: ["https://en.wikipedia.org/wiki/X"] }), // dupe
        trek({ id: "c", image: { url: "https://upload.wikimedia.org/p.jpg", attribution: "x" } }),
        trek({
          id: "d",
          historicalNote: { text: "t", source: "s", year: 1908, url: "https://archive.org/q" },
        }),
      ],
      [],
    );
    expect(urls.sort()).toEqual([
      "https://archive.org/q",
      "https://en.wikipedia.org/wiki/X",
      "https://geonames.org/1",
      "https://upload.wikimedia.org/p.jpg",
    ]);
  });

  it("harvests links out of the content pages too", () => {
    const urls = collectUrls([], ["See [OSM](https://www.openstreetmap.org/copyright) and more."]);
    expect(urls).toContain("https://www.openstreetmap.org/copyright");
  });

  it("ignores non-https references — only real external links rot", () => {
    const urls = collectUrls([trek({ id: "a", sources: ["/trailward/about/"] })], ["no links"]);
    expect(urls).toEqual([]);
  });

  it("strips trailing punctuation picked up from prose", () => {
    expect(collectUrls([], ["see https://example.com/page."])).toEqual([
      "https://example.com/page",
    ]);
  });
});

describe("sampleByHost (spec 37 — a representative sample, not 120k round-trips)", () => {
  const urls = [
    "https://a.com/1",
    "https://a.com/2",
    "https://a.com/3",
    "https://b.com/1",
    "https://b.com/2",
  ];

  it("caps the number checked per host", () => {
    const picked = sampleByHost(urls, 2);
    expect(picked.filter((u) => u.includes("a.com"))).toHaveLength(2);
    expect(picked.filter((u) => u.includes("b.com"))).toHaveLength(2);
  });

  it("covers EVERY host — a host checked zero times is a blind spot", () => {
    const hosts = new Set(sampleByHost(urls, 1).map((u) => new URL(u).hostname));
    expect(hosts).toEqual(new Set(["a.com", "b.com"]));
  });

  it("skips unparseable entries instead of throwing mid-run", () => {
    expect(() => sampleByHost(["not a url", ...urls], 1)).not.toThrow();
  });
});

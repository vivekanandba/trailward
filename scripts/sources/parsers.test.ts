import { describe, it, expect } from "vitest";
import { parsePeaks, parseLatLngs } from "./overpass";
import { parseElevations, chunk } from "./elevation";
import { parseGeoSearchCount } from "./geosearch";
import { parseRoute } from "./route";
import { parseWikiSummary, titleFromWikiUrl, commonsFilePage } from "./wiki";
import { parseDetails } from "./scrape";
import { assertAllowedHost, isAllowedHost } from "./http";

describe("parsePeaks (Overpass fixture)", () => {
  const fixture = {
    elements: [
      { type: "node", id: 1, lat: 13.5, lon: 77.6, tags: { name: "Skandagiri", ele: "1350" } },
      { type: "node", id: 2, lat: 13.4, lon: 77.7, tags: { ele: "1478" } }, // unnamed
      { type: "node", id: 3, lat: "bad", lon: 77.7, tags: {} }, // dropped
    ],
  };

  it("turns Overpass JSON into partial treks with coords + elevation", () => {
    const peaks = parsePeaks(fixture);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toMatchObject({ id: "osm-1", name: "Skandagiri", elevationM: 1350 });
    expect(peaks[1].name).toBe("Unnamed Peak");
  });
});

describe("parseElevations (Open-Meteo)", () => {
  it("parses the elevation array and rejects out-of-range values", () => {
    expect(parseElevations({ elevation: [1350, -5, 99999, 882] })).toEqual([
      1350,
      undefined,
      undefined,
      882,
    ]);
  });
  it("returns [] for a malformed response", () => {
    expect(parseElevations({})).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into fixed-size groups with a shorter tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns [] for an empty input", () => {
    expect(chunk([], 100)).toEqual([]);
  });
});

describe("parseLatLngs (Overpass)", () => {
  it("reads node coords and way/relation centroids, dropping invalid ones", () => {
    const pts = parseLatLngs({
      elements: [
        { type: "node", lat: 18.5, lon: 73.8 },
        { type: "way", center: { lat: 19.0, lon: 72.9 } },
        { type: "node", lat: "bad", lon: 1 },
      ],
    });
    expect(pts).toEqual([
      { lat: 18.5, lng: 73.8 },
      { lat: 19.0, lng: 72.9 },
    ]);
  });
});

describe("parseGeoSearchCount (Wikipedia)", () => {
  it("counts nearby articles", () => {
    expect(parseGeoSearchCount({ query: { geosearch: [{ title: "A" }, { title: "B" }] } })).toBe(2);
  });
  it("returns 0 for an empty or malformed response", () => {
    expect(parseGeoSearchCount({ query: { geosearch: [] } })).toBe(0);
    expect(parseGeoSearchCount({})).toBe(0);
  });
});

describe("parseRoute (OSRM)", () => {
  it("converts metres/seconds into km + minutes", () => {
    const r = parseRoute({ routes: [{ distance: 61234, duration: 5400 }] });
    expect(r).toEqual({ distanceKm: 61.2, driveTimeMin: 90 });
  });
  it("returns undefined when there is no route", () => {
    expect(parseRoute({ routes: [] })).toBeUndefined();
  });
});

describe("parseWikiSummary", () => {
  it("extracts the summary and a Commons image with attribution", () => {
    const info = parseWikiSummary({
      extract: "A hill fort near Bengaluru.",
      originalimage: { source: "https://upload.wikimedia.org/x.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Skandagiri" } },
    });
    expect(info.summary).toBe("A hill fort near Bengaluru.");
    expect(info.image?.url).toContain("upload.wikimedia.org");
    expect(info.image?.attribution).toBeTruthy();
  });

  it("skips a non-Commons image (can't attribute its license)", () => {
    const info = parseWikiSummary({
      extract: "x",
      thumbnail: { source: "https://example.com/x.jpg" },
    });
    expect(info.image).toBeUndefined();
  });

  it("derives the Commons file page from an upload URL (attribution links the license)", () => {
    expect(
      commonsFilePage("https://upload.wikimedia.org/wikipedia/commons/a/a8/Skandagiri.jpg"),
    ).toBe("https://commons.wikimedia.org/wiki/File:Skandagiri.jpg");
    expect(
      commonsFilePage(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Skandagiri.jpg/330px-Skandagiri.jpg",
      ),
    ).toBe("https://commons.wikimedia.org/wiki/File:Skandagiri.jpg");
    expect(commonsFilePage("not a url")).toBeUndefined();
  });

  it("attributes a Commons image to its file page, not the article", () => {
    const info = parseWikiSummary({
      extract: "x",
      originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/a8/Foo.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Foo" } },
    });
    expect(info.image?.attribution).toContain("commons.wikimedia.org/wiki/File:Foo.jpg");
  });

  it("derives a page title from a Wikipedia URL", () => {
    expect(titleFromWikiUrl("https://en.wikipedia.org/wiki/Nandi_Hills,_India")).toBe(
      "Nandi_Hills,_India",
    );
    expect(titleFromWikiUrl("https://example.com/x")).toBeUndefined();
  });
});

describe("parseDetails (scrape)", () => {
  it("pulls difficulty / permit / fee from a recognisable page", () => {
    const html = `<html><body>
      <p>Difficulty: Moderate</p>
      <p>Permit required: yes</p>
      <p>Entry fee: ₹250 / head</p>
    </body></html>`;
    const out = parseDetails(html);
    expect(out.difficulty).toBe("Moderate");
    expect(out.permitRequired).toBe(true);
    expect(out.entryFee).toMatch(/₹\s?250/);
  });

  it("reads a negated permit as not-required (not the reverse)", () => {
    expect(
      parseDetails("<body><p>No permit required for this trek.</p></body>").permitRequired,
    ).toBe(false);
    expect(parseDetails("<body><p>Permit required: no</p></body>").permitRequired).toBe(false);
    expect(parseDetails("<body><p>Permit: not required</p></body>").permitRequired).toBe(false);
    expect(parseDetails("<body><p>Permit: required</p></body>").permitRequired).toBe(true);
  });

  it("does not read a fee out of unrelated words like 'coffee'", () => {
    const out = parseDetails("<body><p>Great coffee: free at the base camp.</p></body>");
    expect(out.entryFee).toBeUndefined();
  });

  it("returns an empty partial for unrecognised/changed HTML (no throw)", () => {
    expect(parseDetails("<html><body><div>totally different layout</div></body></html>")).toEqual(
      {},
    );
    expect(parseDetails("not even html <<<")).toEqual({});
  });
});

describe("host allowlist", () => {
  it("allows the API source hosts", () => {
    expect(isAllowedHost("https://api.open-meteo.com/v1/elevation")).toBe(true);
    expect(isAllowedHost("https://overpass-api.de/api/interpreter")).toBe(true);
  });
  it("rejects disallowed hosts (AllTrails / Google)", () => {
    expect(isAllowedHost("https://www.alltrails.com/x")).toBe(false);
    expect(() => assertAllowedHost("https://maps.google.com/x")).toThrow(/not allowed/);
  });
});

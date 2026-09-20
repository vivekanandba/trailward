import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * API contract tests for the source adapters (spec 41 §B / spec 02).
 *
 * Driven at the `http` boundary so each adapter's real parsing and fallback
 * logic runs. The emphasis is on the FAILURE shapes, because those are what
 * this project has actually been bitten by: a source that answers 200 with an
 * error body, one that returns fewer rows than asked for, and one that is
 * simply down — each of which must degrade to a stated "unknown" rather than a
 * confident wrong answer (CON-DATA-001, CON-DATA-002).
 */
const fetchJson = vi.hoisted(() => vi.fn());
const fetchText = vi.hoisted(() => vi.fn());
const fetchBuffer = vi.hoisted(() => vi.fn());
vi.mock("./http", async (orig) => ({
  ...(await orig<typeof import("./http")>()),
  fetchJson,
  fetchText,
  fetchBuffer,
}));

const { parseGeoSearchCount, parseGeoSearchHits, fetchNearestArticle, fetchGeoSearchCount } =
  await import("./geosearch");
const { parseReverseTown, fetchNearestTown } = await import("./reverse");
const { fetchElevations, chunk } = await import("./elevation");

beforeEach(() => {
  fetchJson.mockReset();
  fetchText.mockReset();
  fetchBuffer.mockReset();
});

describe("Wikipedia GeoSearch (spec 11)", () => {
  const payload = (rows: unknown[]) => ({ query: { geosearch: rows } });

  it("counts nearby articles from a real-shaped payload", () => {
    expect(parseGeoSearchCount(payload([{ title: "A" }, { title: "B" }]))).toBe(2);
  });

  it("returns 0 for a well-formed response with no hits", () => {
    expect(parseGeoSearchCount(payload([]))).toBe(0);
  });

  it("returns 0 rather than throwing on a shape it does not recognise", () => {
    // MediaWiki answers an error with a 200 and a completely different body.
    for (const bad of [{}, { query: {} }, { error: { code: "toofar" } }, null, "nonsense"]) {
      expect(parseGeoSearchCount(bad)).toBe(0);
    }
  });

  it("orders hits nearest first and drops rows with no title", () => {
    const hits = parseGeoSearchHits(
      payload([{ title: "Far", dist: 900 }, { title: "Near", dist: 10 }, { dist: 5 }]),
    );
    expect(hits.map((h) => h.title)).toEqual(["Near", "Far"]);
  });

  it("treats a missing distance as 0 rather than NaN", () => {
    expect(parseGeoSearchHits(payload([{ title: "A" }]))[0].dist).toBe(0);
  });

  it("returns -1 — 'unknown', not 'undocumented' — when the lookup fails", async () => {
    // The distinction matters: 0 means "checked, nothing there" and feeds the
    // obscurity score; -1 means "never looked" and must stay neutral.
    fetchJson.mockRejectedValueOnce(new Error("503"));
    expect(await fetchGeoSearchCount(13, 77)).toBe(-1);
  });

  it("returns the count when the lookup succeeds", async () => {
    fetchJson.mockResolvedValueOnce(payload([{ title: "A" }]));
    expect(await fetchGeoSearchCount(13, 77)).toBe(1);
  });

  it("names the nearest article, and undefined when there is none", async () => {
    fetchJson.mockResolvedValueOnce(payload([{ title: "Nandi Hills", dist: 30 }]));
    expect(await fetchNearestArticle(13, 77)).toBe("Nandi Hills");
    fetchJson.mockResolvedValueOnce(payload([]));
    expect(await fetchNearestArticle(13, 77)).toBeUndefined();
  });

  it("returns undefined on failure rather than a wrong title", async () => {
    fetchJson.mockRejectedValueOnce(new Error("timeout"));
    expect(await fetchNearestArticle(13, 77)).toBeUndefined();
  });

  it("asks the allowlisted Wikipedia host, with the point and radius", async () => {
    fetchJson.mockResolvedValueOnce(payload([]));
    await fetchGeoSearchCount(13.37, 77.68, 500);
    const url = fetchJson.mock.calls[0][0] as string;
    expect(new URL(url).hostname).toBe("en.wikipedia.org");
    expect(url).toContain("gsradius=500");
    expect(decodeURIComponent(url)).toContain("13.37|77.68");
  });
});

describe("Nominatim reverse geocode (spec 11)", () => {
  it("prefers the most place-like label available", () => {
    expect(parseReverseTown({ address: { county: "Chikkaballapur", town: "Nandi" } })).toBe(
      "Nandi",
    );
    expect(parseReverseTown({ address: { county: "Chikkaballapur" } })).toBe("Chikkaballapur");
  });

  it("returns undefined rather than an empty or whitespace name", () => {
    expect(parseReverseTown({ address: { town: "   " } })).toBeUndefined();
    expect(parseReverseTown({ address: {} })).toBeUndefined();
    expect(parseReverseTown({})).toBeUndefined();
    expect(parseReverseTown(null)).toBeUndefined();
  });

  it("trims a padded name", () => {
    expect(parseReverseTown({ address: { village: "  Sultanpet " } })).toBe("Sultanpet");
  });

  it("returns undefined when the service fails, never a guess", async () => {
    fetchJson.mockRejectedValueOnce(new Error("429"));
    expect(await fetchNearestTown(13, 77)).toBeUndefined();
  });

  it("asks the allowlisted Nominatim host", async () => {
    fetchJson.mockResolvedValueOnce({ address: { town: "Nandi" } });
    expect(await fetchNearestTown(13.37, 77.68)).toBe("Nandi");
    expect(new URL(fetchJson.mock.calls[0][0] as string).hostname).toBe(
      "nominatim.openstreetmap.org",
    );
  });
});

describe("elevation with failover (spec 11)", () => {
  const openMeteo = (...elevation: number[]) => ({ elevation });
  const topo = (...ms: number[]) => ({ results: ms.map((elevation) => ({ elevation })) });

  it("chunks a long list so no request exceeds the per-call limit", () => {
    expect(
      chunk(
        Array.from({ length: 250 }, (_, i) => i),
        100,
      ).map((c) => c.length),
    ).toEqual([100, 100, 50]);
    expect(chunk([], 100)).toEqual([]);
  });

  it("returns an empty array for no points without calling out at all", async () => {
    expect(await fetchElevations([])).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("reads elevations from the primary source", async () => {
    fetchJson.mockResolvedValueOnce(openMeteo(900, 910));
    expect(
      await fetchElevations([
        { lat: 13, lng: 77 },
        { lat: 14, lng: 78 },
      ]),
    ).toEqual([900, 910]);
  });

  it("FAILS OVER to the secondary source when the primary throws", async () => {
    // A throttle must degrade resolution, not abort the region.
    fetchJson.mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce(topo(905));
    expect(await fetchElevations([{ lat: 13, lng: 77 }])).toEqual([905]);
    expect(new URL(fetchJson.mock.calls[1][0] as string).hostname).toBe("api.opentopodata.org");
  });

  it("fails over when the primary returns the WRONG NUMBER of results", async () => {
    // A short answer silently misaligns every later point with its coordinate,
    // which is worse than no answer at all.
    fetchJson.mockResolvedValueOnce(openMeteo(900)).mockResolvedValueOnce(topo(900, 910));
    expect(
      await fetchElevations([
        { lat: 13, lng: 77 },
        { lat: 14, lng: 78 },
      ]),
    ).toEqual([900, 910]);
  });

  it("keeps results index-aligned across chunk boundaries", async () => {
    const points = Array.from({ length: 150 }, (_, i) => ({ lat: 13 + i / 1000, lng: 77 }));
    fetchJson
      .mockResolvedValueOnce(openMeteo(...Array.from({ length: 100 }, (_, i) => 1000 + i)))
      .mockResolvedValueOnce(openMeteo(...Array.from({ length: 50 }, (_, i) => 2000 + i)));
    const out = await fetchElevations(points);
    expect(out).toHaveLength(150);
    expect(out[0]).toBe(1000);
    expect(out[99]).toBe(1099);
    expect(out[100]).toBe(2000);
  });

  it("propagates when BOTH sources fail rather than inventing ground", async () => {
    fetchJson.mockRejectedValue(new Error("down"));
    await expect(fetchElevations([{ lat: 13, lng: 77 }])).rejects.toThrow();
  });
});

const { parseWikidataMatches, fetchWikidataKnown, fetchHeritageSites, parseHeritageSites } =
  await import("./wikidata");
const { fetchNearbyPhotos, fetchNearbyPhoto } = await import("./commons");

describe("Wikidata cross-match (spec 18/31)", () => {
  const sparql = (bindings: unknown[]) => JSON.stringify({ results: { bindings } });

  it("keys matches by GeoNames id and notes whether an article exists", () => {
    const m = parseWikidataMatches(
      sparql([
        { geonames: { value: "1270000" }, article: { value: "https://en.wikipedia.org/wiki/X" } },
        { geonames: { value: "1270001" } },
      ]),
    );
    expect(m.get("1270000")).toMatchObject({ hasArticle: true });
    expect(m.get("1270001")).toMatchObject({ hasArticle: false });
  });

  it("keeps hasArticle true once any row says so — rows repeat per language", () => {
    const m = parseWikidataMatches(
      sparql([
        { geonames: { value: "1" }, article: { value: "https://en.wikipedia.org/wiki/X" } },
        { geonames: { value: "1" } },
      ]),
    );
    expect(m.get("1")!.hasArticle).toBe(true);
  });

  it("carries a photo forward across rows rather than losing it to a later blank", () => {
    const m = parseWikidataMatches(
      sparql([
        { geonames: { value: "1" }, image: { value: "https://commons/x.jpg" } },
        { geonames: { value: "1" } },
      ]),
    );
    expect(m.get("1")!.image).toBe("https://commons/x.jpg");
  });

  it("skips a row with no GeoNames id — there is nothing to join on", () => {
    expect(parseWikidataMatches(sparql([{ article: { value: "x" } }])).size).toBe(0);
  });

  it("returns empty for a well-formed response with no results", () => {
    expect(parseWikidataMatches(sparql([])).size).toBe(0);
    expect(parseWikidataMatches(JSON.stringify({})).size).toBe(0);
  });

  it("queries the allowlisted SPARQL host asking for JSON results", async () => {
    fetchText.mockResolvedValueOnce(sparql([]));
    await fetchWikidataKnown({ lat: 13, lng: 77, name: "x", id: "x" }, 50);
    const [url, opts] = fetchText.mock.calls[0];
    expect(new URL(url as string).hostname).toBe("query.wikidata.org");
    expect((opts as { headers: Record<string, string> }).headers.accept).toMatch(/sparql-results/);
    // Box scans are slow; a default timeout would abort every one of them.
    expect((opts as { timeoutMs: number }).timeoutMs).toBeGreaterThan(30_000);
  });

  it("reads heritage designations with their status label", async () => {
    fetchText.mockResolvedValueOnce(
      JSON.stringify({
        results: {
          bindings: [
            {
              coord: { value: "Point(77.68 13.37)" },
              statusLabel: { value: "Monument of National Importance" },
            },
          ],
        },
      }),
    );
    const sites = await fetchHeritageSites({ lat: 13, lng: 77, name: "x", id: "x" }, 50);
    expect(sites[0]).toMatchObject({ status: "Monument of National Importance" });
    // The coordinate has to survive the WKT unwrapping in the right order.
    expect(sites[0].lng).toBeCloseTo(77.68, 2);
    expect(sites[0].lat).toBeCloseTo(13.37, 2);
  });

  it("ignores a heritage row whose coordinate cannot be parsed", () => {
    expect(
      parseHeritageSites(
        JSON.stringify({
          results: { bindings: [{ coord: { value: "not a point" }, statusLabel: { value: "x" } }] },
        }),
      ),
    ).toEqual([]);
  });
});

describe("Wikimedia Commons photos (spec 12)", () => {
  const geo = (...titles: string[]) => ({
    query: { geosearch: titles.map((title) => ({ title })) },
  });
  const info = (...urls: string[]) => ({
    query: {
      pages: Object.fromEntries(
        urls.map((u, i) => [
          String(i),
          {
            title: `File:${i}.jpg`,
            imageinfo: [
              {
                thumburl: u,
                url: u,
                extmetadata: {
                  LicenseShortName: { value: "CC BY-SA 4.0" },
                  Artist: { value: "Someone" },
                },
              },
            ],
          },
        ]),
      ),
    },
  });

  it("returns photos WITH their licence and author — attribution is not optional", async () => {
    fetchJson
      .mockResolvedValueOnce(geo("File:A.jpg"))
      .mockResolvedValueOnce(info("https://x/a.jpg"));
    const photos = await fetchNearbyPhotos(13, 77);
    expect(photos).toHaveLength(1);
    expect(photos[0].attribution).toBeTruthy();
  });

  it("returns nothing when no file is geotagged nearby, without a second call", async () => {
    fetchJson.mockResolvedValueOnce(geo());
    expect(await fetchNearbyPhotos(13, 77)).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("returns empty on failure rather than throwing into the build", async () => {
    fetchJson.mockRejectedValueOnce(new Error("503"));
    expect(await fetchNearbyPhotos(13, 77)).toEqual([]);
  });

  it("fetchNearbyPhoto returns just the first, or undefined", async () => {
    fetchJson
      .mockResolvedValueOnce(geo("File:A.jpg"))
      .mockResolvedValueOnce(info("https://x/a.jpg"));
    expect(await fetchNearbyPhoto(13, 77)).toBeDefined();
    fetchJson.mockResolvedValueOnce(geo());
    expect(await fetchNearbyPhoto(13, 77)).toBeUndefined();
  });

  it("asks the allowlisted Commons host for image namespace files only", async () => {
    fetchJson.mockResolvedValueOnce(geo());
    await fetchNearbyPhotos(13.37, 77.68, 2000, 2);
    const url = fetchJson.mock.calls[0][0] as string;
    expect(new URL(url).hostname).toBe("commons.wikimedia.org");
    expect(url).toContain("gsnamespace=6");
    expect(url).toContain("gsradius=2000");
  });
});

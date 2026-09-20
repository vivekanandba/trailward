import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The outbound HTTP policy (spec 02) is the single place every build tool's
 * network traffic passes through, and it was almost entirely untested: the
 * allowlist had tests, the retry/backoff/status handling did not.
 *
 * These are the API contract tests spec 41 §B calls for — driven at the undici
 * boundary so the real policy code runs, and written around the FAILURE shapes
 * rather than the happy path, because the failures are what has bitten here:
 * an endpoint that 429s on a per-minute window, a 3xx whose body is a stub,
 * and a 5xx that clears on retry.
 */
const request = vi.hoisted(() => vi.fn());
vi.mock("undici", () => ({ request }));

const { fetchText, fetchJson, fetchBuffer, isAllowedHost, assertAllowedHost, ALLOWED_HOSTS } =
  await import("./http");

const OK = "https://overpass-api.de/api/interpreter";

/** Build an undici-shaped response. */
const res = (statusCode: number, body = "") => ({
  statusCode,
  body: {
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    dump: async () => {},
  },
});

// No throttle and no retry unless a test asks: the policy's sleeps are real.
const fast = { throttleMs: 0, retries: 0 };

beforeEach(() => {
  request.mockReset();
});

describe("host allowlist (spec 02)", () => {
  it("permits the sources the project actually uses", () => {
    expect(isAllowedHost(OK)).toBe(true);
    expect(isAllowedHost("https://query.wikidata.org/sparql")).toBe(true);
  });

  it("REFUSES the hosts this project must never scrape", () => {
    // AllTrails and Google Maps/Places are deliberately absent: scraping them
    // violates their terms, and no amount of convenience changes that.
    for (const url of [
      "https://www.alltrails.com/x",
      "https://maps.googleapis.com/maps/api/place/x",
      "https://www.google.com/maps",
    ]) {
      expect(isAllowedHost(url), url).toBe(false);
    }
    expect(ALLOWED_HOSTS.has("www.alltrails.com")).toBe(false);
  });

  it("treats an unparseable URL as not allowed rather than throwing", () => {
    expect(isAllowedHost("not a url")).toBe(false);
  });

  it("names the offending URL when it refuses", () => {
    expect(() => assertAllowedHost("https://evil.example/x")).toThrow(/not allowed/);
  });

  it("refuses before any request is made", async () => {
    await expect(fetchText("https://evil.example/x", fast)).rejects.toThrow(/not allowed/);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("fetchText (spec 02/41)", () => {
  it("returns the body and sends a descriptive User-Agent", async () => {
    request.mockResolvedValueOnce(res(200, "hello"));
    expect(await fetchText(OK, fast)).toBe("hello");
    const [, opts] = request.mock.calls[0];
    // A bot with no contact address is a bot that gets blocked.
    expect(opts.headers["user-agent"]).toMatch(/Trailward/);
    expect(opts.headers["user-agent"]).toMatch(/github\.com/);
  });

  it("RETRIES a 5xx and succeeds on a later attempt", async () => {
    request.mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, "recovered"));
    expect(await fetchText(OK, { throttleMs: 0, retries: 1 })).toBe("recovered");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx — it will not change on retry", async () => {
    request.mockResolvedValue(res(404));
    await expect(fetchText(OK, { throttleMs: 0, retries: 3 })).rejects.toThrow(/404/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does NOT return a 3xx body — undici does not follow redirects", async () => {
    // Returning the stub body would feed garbage straight into JSON.parse.
    request.mockResolvedValue(res(302, "<html>moved</html>"));
    await expect(fetchText(OK, fast)).rejects.toThrow(/302/);
  });

  it("treats a 429 as retryable, unlike other 4xx", async () => {
    request.mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200, "after the window"));
    expect(await fetchText(OK, { throttleMs: 0, retries: 1 })).toBe("after the window");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and surfaces the last error", async () => {
    request.mockResolvedValue(res(500));
    await expect(fetchText(OK, { throttleMs: 0, retries: 2 })).rejects.toThrow(/500/);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("retries a thrown transport error, not only an HTTP status", async () => {
    request
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(res(200, "second time"));
    expect(await fetchText(OK, { throttleMs: 0, retries: 1 })).toBe("second time");
  });

  it("bounds each attempt with a timeout so one stalled host cannot hang a build", async () => {
    request.mockResolvedValueOnce(res(200, "x"));
    await fetchText(OK, fast);
    const [, opts] = request.mock.calls[0];
    expect(opts.headersTimeout).toBeGreaterThan(0);
    expect(opts.bodyTimeout).toBeGreaterThan(0);
  });

  it("passes a POST body through for SPARQL-style endpoints", async () => {
    request.mockResolvedValueOnce(res(200, "{}"));
    await fetchText(OK, { ...fast, method: "POST", body: "query=SELECT" });
    const [, opts] = request.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe("query=SELECT");
  });
});

describe("fetchJson (spec 02)", () => {
  it("parses a JSON body", async () => {
    request.mockResolvedValueOnce(res(200, '{"a":1}'));
    expect(await fetchJson(OK, fast)).toEqual({ a: 1 });
  });

  it("fails loudly on a body that is not JSON, rather than returning undefined", async () => {
    // An HTML error page served with a 200 is a real failure mode here.
    request.mockResolvedValueOnce(res(200, "<html>rate limited</html>"));
    await expect(fetchJson(OK, fast)).rejects.toThrow();
  });
});

describe("fetchBuffer (spec 02/17)", () => {
  const TILE = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/1/1.png";

  it("returns the bytes for a tile that exists", async () => {
    request.mockResolvedValueOnce(res(200, "PNGDATA"));
    const buf = await fetchBuffer(TILE, fast);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.toString()).toBe("PNGDATA");
  });

  it("returns NULL on 404 — a missing tile is ocean, not a build failure", async () => {
    request.mockResolvedValueOnce(res(404));
    expect(await fetchBuffer(TILE, fast)).toBeNull();
  });

  it("still throws on other 4xx, so a real problem is not read as ocean", async () => {
    request.mockResolvedValue(res(403));
    await expect(fetchBuffer(TILE, { throttleMs: 0, retries: 2 })).rejects.toThrow(/403/);
    expect(request).toHaveBeenCalledTimes(1); // not retried
  });

  it("retries a 5xx", async () => {
    request.mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200, "PNG"));
    expect((await fetchBuffer(TILE, { throttleMs: 0, retries: 1 }))!.toString()).toBe("PNG");
  });

  it("enforces the allowlist for bytes too", async () => {
    await expect(fetchBuffer("https://evil.example/tile.png", fast)).rejects.toThrow(/not allowed/);
  });
});

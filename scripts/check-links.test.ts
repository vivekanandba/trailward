import { describe, it, expect } from "vitest";
import { collectUrls, sampleByHost, runCheckLinks, probe } from "./check-links";
import { memoryIO } from "./lib/buildIO";
import type { Result } from "./lib/linkcheck";
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

describe("check-links run (spec 37/41)", () => {
  const ROOT = "/repo";
  const trek = (over: Partial<Trek> & Pick<Trek, "id">): Trek => ({
    name: over.id!,
    lat: 13,
    lng: 77,
    tier: "discovery",
    sources: [],
    verified: false,
    ...over,
  });

  const seeded = (treks: Trek[], content: Record<string, string> = { "about.md": "" }) =>
    memoryIO({
      [`${ROOT}/src/data/treks.json`]: JSON.stringify(treks),
      ...Object.fromEntries(Object.entries(content).map(([f, b]) => [`${ROOT}/content/${f}`, b])),
    });

  const ok = (url: string): Result => ({ url, outcome: "ok", status: 200, finalUrl: url });

  it("collects URLs from the dataset AND from every content page", async () => {
    const io = seeded([trek({ id: "a", sources: ["https://a.example/x"] })], {
      "about.md": "See [b](https://b.example/y).",
      "faq.md": "And [c](https://c.example/z).",
    });
    const asked: string[] = [];
    const out = await runCheckLinks(
      io,
      ROOT,
      {
        probe: async (u) => {
          asked.push(u);
          return ok(u);
        },
      },
      true,
    );
    expect(out.urls).toBe(3);
    // A content page added later must be probed too — that is the whole point
    // of deriving the list rather than hardcoding it.
    expect(asked.sort()).toEqual([
      "https://a.example/x",
      "https://b.example/y",
      "https://c.example/z",
    ]);
  });

  it("samples by host by default, and probes everything with --all", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      trek({ id: `t${i}`, sources: [`https://same.example/${i}`] }),
    );
    const sampled = await runCheckLinks(seeded(many), ROOT, { probe: async (u) => ok(u) }, false);
    const every = await runCheckLinks(seeded(many), ROOT, { probe: async (u) => ok(u) }, true);
    expect(sampled.checked).toBeLessThan(every.checked);
    expect(every.checked).toBe(30);
  });

  it("names a broken link in the report but stays ADVISORY (exit 0)", async () => {
    // Deliberate: link rot is upstream's doing, and a red build every time a
    // third party reorganises its site would train everyone to ignore it. The
    // report has to name the URL, though, or the job tells nobody anything.
    const io = seeded([trek({ id: "a", sources: ["https://gone.example/x"] })]);
    const out = await runCheckLinks(
      io,
      ROOT,
      { probe: async (u) => ({ url: u, outcome: "failed", status: 404, finalUrl: u }) },
      true,
    );
    expect(out.exitCode).toBe(0);
    expect(out.text).toContain("https://gone.example/x");
    expect(out.text).toMatch(/failed/i);
  });

  it("passes its report to the CI step summary when one is available", async () => {
    const io = seeded([trek({ id: "a", sources: ["https://a.example/x"] })]);
    const written: string[] = [];
    await runCheckLinks(
      io,
      ROOT,
      { probe: async (u) => ok(u), writeSummary: (t) => written.push(t) },
      true,
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toBe((await Promise.resolve(io.logs)).at(-1));
  });
});

describe("probe (spec 37)", () => {
  it("falls back to GET when a host does not implement HEAD", async () => {
    const methods: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      methods.push(init.method!);
      return { status: methods.length === 1 ? 405 : 200, url: "https://x.example/" };
    }) as unknown as typeof fetch;
    const r = await probe("https://x.example/", fake);
    expect(methods).toEqual(["HEAD", "GET"]);
    expect(r.status).toBe(200);
  });

  it("reports a thrown transport error as a result, never crashing the run", async () => {
    const fake = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const r = await probe("https://nope.example/", fake);
    expect(r.status).toBe(0);
    expect(r.outcome).toBeTruthy();
  });
});

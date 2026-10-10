import { describe, it, expect } from "vitest";
import {
  versionFile,
  checkDeployedVersion,
  checkPage,
  summariseDeploy,
  DEPLOY_SURFACE,
  jsonLdProblem,
  parseTrekPage,
  pickJsonLdSample,
  sampleFromVersion,
  type PageResult,
} from "./deploycheck";

const SHA = "a".repeat(40);
const PREV = "b".repeat(40);

describe("version.json (spec 42 §B)", () => {
  it("carries the sha and a build time, and round-trips", () => {
    const parsed = JSON.parse(versionFile(SHA, "2026-09-21T00:00:00.000Z", ["t/a/"]));
    expect(parsed.sha).toBe(SHA);
    expect(parsed.builtAt).toBe("2026-09-21T00:00:00.000Z");
  });

  it("ends in a newline, like every other committed artefact here", () => {
    expect(versionFile(SHA, "x", ["t/a/"]).endsWith("\n")).toBe(true);
  });
});

describe("checkDeployedVersion — 'stale' and 'wrong' are different answers", () => {
  it("passes when the live sha is the one just built", () => {
    expect(checkDeployedVersion(versionFile(SHA, "x", ["t/a/"]), SHA)).toMatchObject({ ok: true });
  });

  it("reports the PREVIOUS sha as stale — the CDN has not turned over yet", () => {
    // Retrying here is correct. Failing would make every deploy flaky.
    const v = checkDeployedVersion(versionFile(PREV, "x", ["t/a/"]), SHA, PREV);
    expect(v).toMatchObject({ stale: true });
  });

  it("treats ANY other sha as possibly-stale and retryable", () => {
    // Not a pass — a bounded retry. The previous sha is frequently unknown
    // (workflow_dispatch has no `before`; a cancelled run leaves the site
    // older still), and in all those cases "a different sha" is usually CDN
    // lag. Failing on attempt one disabled the retry budget silently.
    expect(
      checkDeployedVersion(versionFile("c".repeat(40), "x", ["t/a/"]), SHA, PREV),
    ).toMatchObject({
      stale: true,
    });
  });

  it("retries rather than failing when NO previous sha is known", () => {
    expect(checkDeployedVersion(versionFile(PREV, "x", ["t/a/"]), SHA)).toMatchObject({
      stale: true,
    });
  });

  it("FAILS on a body that is not JSON — a 404 page, say", () => {
    expect(checkDeployedVersion("<html>404</html>", SHA)).toMatchObject({ ok: false });
  });

  it("FAILS when the file carries no sha, rather than treating it as a skip", () => {
    // A missing value must never read as "nothing to check" — that is exactly
    // how an unverified deploy passes for green.
    expect(checkDeployedVersion("{}", SHA)).toMatchObject({ ok: false });
    expect(checkDeployedVersion('{"sha":""}', SHA)).toMatchObject({ ok: false });
    expect(checkDeployedVersion('{"sha":123}', SHA)).toMatchObject({ ok: false });
  });

  it("names both shas in its detail, so the log says what is actually served", () => {
    const v = checkDeployedVersion(versionFile(PREV, "x", ["t/a/"]), SHA);
    expect(v.detail).toContain(PREV.slice(0, 8));
    expect(v.detail).toContain(SHA.slice(0, 8));
  });
});

describe("checkPage — a 200 is not enough", () => {
  const html = { path: "t/skandagiri/", contains: "Skandagiri", contentType: "text/html" };

  it("passes a page that returns 200 with the right content and type", () => {
    expect(checkPage(html, 200, "<h1>Skandagiri</h1>", "text/html; charset=utf-8")).toMatchObject({
      ok: true,
    });
  });

  it("fails a non-200", () => {
    expect(checkPage(html, 404, "", "text/html")).toMatchObject({ ok: false, detail: "HTTP 404" });
  });

  it("fails a SOFT 404 — the SPA shell served where a generated page should be", () => {
    // This is the failure a status-only check cannot see: 200, correct type,
    // and the crawler gets the app shell instead of the page it asked for.
    const v = checkPage(html, 200, '<div id="root"></div>', "text/html");
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("Skandagiri");
  });

  it("fails the wrong content type — an XML sitemap served as HTML is broken", () => {
    const sitemap = { path: "sitemap.xml", contains: "<urlset", contentType: "xml" };
    expect(checkPage(sitemap, 200, "<urlset></urlset>", "text/html")).toMatchObject({ ok: false });
  });

  it("labels the site root as '/' rather than an empty string", () => {
    expect(checkPage({ path: "" }, 200, "x").path).toBe("/");
  });
});

describe("the deploy surface", () => {
  it("covers the app shell, the crawl files, a trek page and every content page", () => {
    const paths = DEPLOY_SURFACE.map((p) => p.path);
    expect(paths).toContain("");
    expect(paths).toContain("sitemap.xml");
    expect(paths).toContain("robots.txt");
    expect(paths.some((p) => p.startsWith("t/"))).toBe(true);
    for (const content of ["about/", "sources/", "data/"]) expect(paths).toContain(content);
  });

  it("asserts CONTENT for every entry, not merely a status", () => {
    for (const p of DEPLOY_SURFACE) {
      expect(p.contains, p.path || "/").toBeTruthy();
    }
  });
});

describe("summariseDeploy", () => {
  const results: PageResult[] = [
    { path: "/", status: 200, ok: true, detail: "ok" },
    { path: "sitemap.xml", status: 404, ok: false, detail: "HTTP 404" },
  ];

  it("separates the failures and names them in the report", () => {
    const s = summariseDeploy(results);
    expect(s.failed.map((r) => r.path)).toEqual(["sitemap.xml"]);
    expect(s.text).toContain("1/2 ok");
    expect(s.text).toContain("sitemap.xml");
  });
});

describe("parseTrekPage (spec 44 R1)", () => {
  it("reads the canonical and the JSON-LD url from the page", () => {
    const html = [
      '<link rel="canonical" href="https://x.test/trailward/t/abapuri-hill/" />',
      '<script type="application/ld+json">{"name":"A \\u003c B","url":"https://x.test/trailward/t/abapuri-hill/"}</script>',
    ].join("\n");
    expect(parseTrekPage(html)).toEqual({
      canonical: "https://x.test/trailward/t/abapuri-hill/",
      jsonLdUrl: "https://x.test/trailward/t/abapuri-hill/",
    });
  });

  it("reports each missing piece as undefined, never as a guess", () => {
    expect(parseTrekPage("<html></html>")).toEqual({ canonical: undefined, jsonLdUrl: undefined });
  });

  it("treats unparseable JSON-LD as absent rather than throwing", () => {
    const broken = '<script type="application/ld+json">{not json</script>';
    expect(parseTrekPage(broken).jsonLdUrl).toBeUndefined();
  });

  it("unescapes the canonical with esc's inverse", () => {
    expect(
      parseTrekPage('<link rel="canonical" href="https://x.test/t/a&amp;b/" />').canonical,
    ).toBe("https://x.test/t/a&b/");
  });
});

describe("pickJsonLdSample (spec 44 R1)", () => {
  const p = (id: string, slug: string, tier = "discovery") => ({ id, slug, tier });

  it("takes one page of each kind whose slug differs from its id, in build order", () => {
    expect(
      pickJsonLdSample([
        p("skandagiri", "skandagiri", "curated"), // slug == id: cannot show the defect
        p("madhugiri", "madhugiri-betta", "curated"),
        p("osm-1", "nandi", "discovery"),
        p("gn-7", "kumara-parvatha"),
        p("gn-8", "second-gn"), // a second of a kind already taken
        p("d12-1-2", "virapuli"),
        p("d12-9", "nandi-hills-d12-9"), // collision-suffixed
      ]),
    ).toEqual([
      "t/madhugiri-betta/",
      "t/nandi-hills-d12-9/",
      "t/kumara-parvatha/",
      "t/virapuli/",
      "t/nandi/",
    ]);
  });

  it("never samples a page whose slug equals its id", () => {
    expect(
      pickJsonLdSample([p("osmx-5", "osmx-5"), p("skandagiri", "skandagiri", "curated")]),
    ).toEqual([]);
  });

  it("never lists one page twice when it fits several kinds", () => {
    // curated AND gn-: taken once, by the first kind that matches.
    expect(pickJsonLdSample([p("gn-1", "kumara", "curated")])).toEqual(["t/kumara/"]);
  });
});

describe("sampleFromVersion (spec 44 R1)", () => {
  it("returns the sample a version.json lists", () => {
    expect(sampleFromVersion(versionFile(SHA, "x", ["t/a/", "t/b/"]))).toEqual(["t/a/", "t/b/"]);
  });

  it("returns null for none, an empty list, a malformed list or a body that is not JSON", () => {
    expect(sampleFromVersion('{"sha":"x"}')).toBeNull();
    expect(sampleFromVersion(versionFile(SHA, "x", []))).toBeNull();
    expect(sampleFromVersion('{"jsonLdSample":[1]}')).toBeNull();
    expect(sampleFromVersion("<html>")).toBeNull();
  });
});

describe("jsonLdProblem (spec 44 R1)", () => {
  const page = (canonical?: string, jsonLdUrl?: string) => ({ canonical, jsonLdUrl });
  const own = "https://x.test/trailward/t/abapuri-hill/";

  it("passes a page whose canonical is its own url and whose JSON-LD matches", () => {
    expect(jsonLdProblem(own, page(own, own))).toBeNull();
  });

  it("fails a JSON-LD url that is not the canonical", () => {
    expect(jsonLdProblem(own, page(own, "https://x.test/trailward/t/gn-1/"))).toMatch(
      /is not the canonical/,
    );
  });

  it("fails when canonical AND JSON-LD agree on a url that is not this page", () => {
    // Self-consistency alone passes all of these; each 404s.
    for (const wrong of [
      "https://x.test/trailward/t/gn-11022928/", // the id-derived url
      "https://x.test/trailward/trailward/t/abapuri-hill/", // a doubled base path
      "http://localhost:5173/t/abapuri-hill/", // the wrong host
    ]) {
      expect(jsonLdProblem(own, page(wrong, wrong)), wrong).toMatch(/is not this page's url/);
    }
  });

  it("names what is missing", () => {
    expect(jsonLdProblem(own, page(undefined, own))).toBe("no canonical");
    expect(jsonLdProblem(own, page(own, undefined))).toBe("no JSON-LD url");
  });
});

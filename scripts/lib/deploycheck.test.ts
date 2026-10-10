import { describe, it, expect } from "vitest";
import {
  versionFile,
  checkDeployedVersion,
  checkPage,
  summariseDeploy,
  DEPLOY_SURFACE,
  jsonLdProblem,
  parseTrekPage,
  sitemapTrekPaths,
  type PageResult,
} from "./deploycheck";

const SHA = "a".repeat(40);
const PREV = "b".repeat(40);

describe("version.json (spec 42 §B)", () => {
  it("carries the sha and a build time, and round-trips", () => {
    const parsed = JSON.parse(versionFile(SHA, "2026-09-21T00:00:00.000Z"));
    expect(parsed.sha).toBe(SHA);
    expect(parsed.builtAt).toBe("2026-09-21T00:00:00.000Z");
  });

  it("ends in a newline, like every other committed artefact here", () => {
    expect(versionFile(SHA, "x").endsWith("\n")).toBe(true);
  });
});

describe("checkDeployedVersion — 'stale' and 'wrong' are different answers", () => {
  it("passes when the live sha is the one just built", () => {
    expect(checkDeployedVersion(versionFile(SHA, "x"), SHA)).toMatchObject({ ok: true });
  });

  it("reports the PREVIOUS sha as stale — the CDN has not turned over yet", () => {
    // Retrying here is correct. Failing would make every deploy flaky.
    const v = checkDeployedVersion(versionFile(PREV, "x"), SHA, PREV);
    expect(v).toMatchObject({ stale: true });
  });

  it("treats ANY other sha as possibly-stale and retryable", () => {
    // Not a pass — a bounded retry. The previous sha is frequently unknown
    // (workflow_dispatch has no `before`; a cancelled run leaves the site
    // older still), and in all those cases "a different sha" is usually CDN
    // lag. Failing on attempt one disabled the retry budget silently.
    expect(checkDeployedVersion(versionFile("c".repeat(40), "x"), SHA, PREV)).toMatchObject({
      stale: true,
    });
  });

  it("retries rather than failing when NO previous sha is known", () => {
    expect(checkDeployedVersion(versionFile(PREV, "x"), SHA)).toMatchObject({ stale: true });
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
    const v = checkDeployedVersion(versionFile(PREV, "x"), SHA);
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
  const html = [
    '<link rel="canonical" href="https://x.test/trailward/t/abapuri-hill/" />',
    '<script type="application/ld+json">{"name":"A \\u003c B","url":"https://x.test/trailward/t/abapuri-hill/"}</script>',
    '<a class="cta" href="/trailward/?sel=gn-11022928">Open on the map →</a>',
  ].join("\n");

  it("reads the canonical, the JSON-LD url and the ?sel= id from the page", () => {
    expect(parseTrekPage(html)).toEqual({
      canonical: "https://x.test/trailward/t/abapuri-hill/",
      jsonLdUrl: "https://x.test/trailward/t/abapuri-hill/",
      selId: "gn-11022928",
    });
  });

  it("reports each missing piece as undefined, never as a guess", () => {
    expect(parseTrekPage("<html></html>")).toEqual({
      canonical: undefined,
      jsonLdUrl: undefined,
      selId: undefined,
    });
  });

  it("treats unparseable JSON-LD as absent rather than throwing", () => {
    const broken = '<script type="application/ld+json">{not json</script>';
    expect(parseTrekPage(broken).jsonLdUrl).toBeUndefined();
  });

  it("inverts exactly what renderTrekPage writes: HTML-escaped, not URL-encoded", () => {
    const page = parseTrekPage(
      '<link rel="canonical" href="https://x.test/t/a&amp;b/" /><a class="cta" href="/?sel=a&amp;b%1">',
    );
    expect(page.canonical).toBe("https://x.test/t/a&b/");
    // `&` is not a terminator and `%` is not decoded — no URIError, no truncation.
    expect(page.selId).toBe("a&b%1");
  });
});

describe("parseTrekPage reads the id from the map link only (spec 44 R1)", () => {
  it("ignores a ?sel= in the description, which carries untrusted prose", () => {
    const page = parseTrekPage(
      '<meta name="description" content="see ?sel=foo for more" />' +
        '<a class="cta" href="/trailward/?sel=gn-1">Open on the map</a>',
    );
    expect(page.selId).toBe("gn-1");
  });
});

describe("sitemapTrekPaths (spec 44 R1)", () => {
  it("returns the /t/ pages as base-relative paths, in sitemap order", () => {
    const xml = [
      "<urlset>",
      "<url><loc>https://x.test/trailward/</loc></url>",
      "<url><loc>https://x.test/trailward/t/skandagiri/</loc></url>",
      "<url><loc>https://x.test/trailward/about/</loc></url>",
      "<url><loc>https://x.test/trailward/t/abapuri-hill/</loc></url>",
      "</urlset>",
    ].join("");
    expect(sitemapTrekPaths(xml)).toEqual(["t/skandagiri/", "t/abapuri-hill/"]);
  });

  it("returns nothing for a body that is not a sitemap", () => {
    expect(sitemapTrekPaths("<html>soft 404</html>")).toEqual([]);
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

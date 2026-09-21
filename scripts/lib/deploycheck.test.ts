import { describe, it, expect } from "vitest";
import {
  versionFile,
  checkDeployedVersion,
  checkPage,
  summariseDeploy,
  DEPLOY_SURFACE,
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

  it("FAILS on a sha that is neither ours nor the previous one", () => {
    // Something else is being served. That is wrong now and will still be
    // wrong in ten seconds, so it must not be retried into a pass.
    const v = checkDeployedVersion(versionFile("c".repeat(40), "x"), SHA, PREV);
    expect(v).toMatchObject({ ok: false });
  });

  it("FAILS when no previous sha is known and the live one differs", () => {
    expect(checkDeployedVersion(versionFile(PREV, "x"), SHA)).toMatchObject({ ok: false });
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

  it("names both shas when it fails, so the log says what is actually served", () => {
    const v = checkDeployedVersion(versionFile(PREV, "x"), SHA);
    expect("detail" in v && v.detail).toContain(PREV.slice(0, 8));
    expect("detail" in v && v.detail).toContain(SHA.slice(0, 8));
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

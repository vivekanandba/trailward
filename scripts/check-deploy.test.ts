import { describe, it, expect } from "vitest";
import { runDeployCheck, type Fetched } from "./check-deploy";
import { memoryIO } from "./lib/buildIO";
import { SITE_URL } from "../src/lib/seo";

/** The production url, spelled out as the code under test spells it. */
const absoluteUrl = (path: string): string => `${SITE_URL}/${path}`;
import { versionFile, DEPLOY_SURFACE } from "./lib/deploycheck";

const SHA = "a".repeat(40);
const PREV = "b".repeat(40);
const BASE = "https://example.test/trailward/";

/** A generated trek page as build-pages writes it, with the given JSON-LD url. */
function trekPage(slug: string, id: string, jsonLdUrl = absoluteUrl(`t/${slug}/`)): Fetched {
  // Canonicals are PRODUCTION urls whatever host serves the page — that is what
  // build-pages writes and what search engines are told.
  return {
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: [
      `<link rel="canonical" href="${absoluteUrl(`t/${slug}/`)}" />`,
      `<script type="application/ld+json">{"url":"${jsonLdUrl}"}</script>`,
      `<h1>Skandagiri</h1><a class="cta" href="/trailward/?sel=${id}">Open on the map</a>`,
    ].join("\n"),
  };
}

/** The sample the build lists in version.json, and the pages it names. */
const SAMPLE: [string, string][] = [
  ["madhugiri-betta", "madhugiri"],
  ["kumara-parvatha", "gn-11022928"],
  ["virapuli", "d12-2928-1951-105-136"],
];
const SAMPLE_PATHS = SAMPLE.map(([slug]) => `t/${slug}/`);

/** A site that serves everything correctly at `sha`. */
function healthySite(sha: string): Record<string, Fetched> {
  const pages: Record<string, Fetched> = {
    "version.json": {
      status: 200,
      body: versionFile(sha, "x", SAMPLE_PATHS),
      contentType: "application/json",
    },
  };
  for (const p of DEPLOY_SURFACE) {
    pages[p.path] = {
      status: 200,
      body: p.contains ?? "",
      contentType:
        p.contentType === "xml"
          ? "application/xml"
          : p.contentType === "text/plain"
            ? "text/plain"
            : "text/html; charset=utf-8",
    };
  }
  for (const [slug, id] of SAMPLE) pages[`t/${slug}/`] = trekPage(slug, id);
  return pages;
}

/** Route a URL to a canned response, ignoring the cache-busting query. */
function serve(pages: Record<string, Fetched>) {
  const asked: string[] = [];
  const get = async (url: string): Promise<Fetched> => {
    asked.push(url);
    const path = url.slice(BASE.length).replace(/\?.*$/, "");
    return pages[path] ?? { status: 404, body: "not found", contentType: "text/html" };
  };
  return { get, asked };
}

const noWait = async () => {};

describe("runDeployCheck (spec 42 §B / CON-COV-001)", () => {
  it("passes when the live site serves exactly what was built", async () => {
    const io = memoryIO();
    const { get } = serve(healthySite(SHA));
    const out = await runDeployCheck(io, { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(out.ok).toBe(true);
    expect(io.logs.join("\n")).toContain("ok");
  });

  it("FAILS when the live site serves a different build", async () => {
    // The whole point of the job. Without it a deploy that silently kept
    // serving the old bundle looked exactly like a successful one.
    const io = memoryIO();
    const { get } = serve(healthySite("c".repeat(40)));
    const out = await runDeployCheck(io, { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(out.ok).toBe(false);
    expect(out.results[0].detail).toContain(SHA.slice(0, 8));
  });

  it("RETRIES while the CDN still serves the previous build, then passes", async () => {
    const pages = healthySite(SHA);
    let call = 0;
    const get = async (url: string): Promise<Fetched> => {
      if (url.includes("version.json")) {
        call++;
        // Two stale answers, then the new build appears.
        return {
          status: 200,
          body: versionFile(call <= 2 ? PREV : SHA, "x", SAMPLE_PATHS),
          contentType: "application/json",
        };
      }
      const path = url.slice(BASE.length).replace(/\?.*$/, "");
      return pages[path] ?? { status: 404, body: "", contentType: "" };
    };
    const io = memoryIO();
    const out = await runDeployCheck(
      io,
      { get, wait: noWait },
      { sha: SHA, previousSha: PREV, base: BASE },
    );
    expect(out.ok).toBe(true);
    expect(call).toBe(3);
    expect(io.logs.join("\n")).toContain("still serving the previous build");
  });

  it("gives up after the retry budget rather than hanging on a stuck CDN", async () => {
    const pages = healthySite(SHA);
    const get = async (url: string): Promise<Fetched> =>
      url.includes("version.json")
        ? {
            status: 200,
            body: versionFile(PREV, "x", SAMPLE_PATHS),
            contentType: "application/json",
          }
        : (pages[url.slice(BASE.length).replace(/\?.*$/, "")] ?? {
            status: 404,
            body: "",
            contentType: "",
          });
    const out = await runDeployCheck(
      memoryIO(),
      { get, wait: noWait },
      { sha: SHA, previousSha: PREV, base: BASE, attempts: 3 },
    );
    expect(out.ok).toBe(false);
  });

  it("retries an unexpected sha to its budget, then FAILS", async () => {
    // A third sha is usually still CDN lag — a run cancelled by the
    // concurrency group leaves the site older than `github.event.before`.
    // So it is retried, but the budget is finite and it does fail.
    let calls = 0;
    const pages = healthySite(SHA);
    const get = async (url: string): Promise<Fetched> => {
      if (url.includes("version.json")) {
        calls++;
        return {
          status: 200,
          body: versionFile("c".repeat(40), "x", SAMPLE_PATHS),
          contentType: "",
        };
      }
      return pages[url.slice(BASE.length).replace(/\?.*$/, "")]!;
    };
    const out = await runDeployCheck(
      memoryIO(),
      { get, wait: noWait },
      { sha: SHA, previousSha: PREV, base: BASE, attempts: 5 },
    );
    expect(calls).toBe(5);
    expect(out.ok).toBe(false);
  });

  it("retries when the previous sha is UNKNOWN, rather than failing at once", async () => {
    // workflow_dispatch supplies no `github.event.before`. Requiring it to
    // earn a retry silently disabled the whole budget.
    let calls = 0;
    const pages = healthySite(SHA);
    const get = async (url: string): Promise<Fetched> => {
      if (url.includes("version.json")) {
        calls++;
        return {
          status: 200,
          body: versionFile(calls <= 2 ? PREV : SHA, "x", SAMPLE_PATHS),
          contentType: "application/json",
        };
      }
      return pages[url.slice(BASE.length).replace(/\?.*$/, "")]!;
    };
    const out = await runDeployCheck(
      memoryIO(),
      { get, wait: noWait },
      { sha: SHA, base: BASE }, // no previousSha at all
    );
    expect(out.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("retries a missing version.json too — the deploy may not have landed yet", async () => {
    let calls = 0;
    const pages = healthySite(SHA);
    const get = async (url: string): Promise<Fetched> => {
      if (url.includes("version.json")) {
        calls++;
        return calls <= 2
          ? { status: 404, body: "not found", contentType: "text/html" }
          : {
              status: 200,
              body: versionFile(SHA, "x", SAMPLE_PATHS),
              contentType: "application/json",
            };
      }
      return pages[url.slice(BASE.length).replace(/\?.*$/, "")]!;
    };
    const out = await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(out.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("FAILS a malformed version.json and SAYS WHY, not 'never checked'", async () => {
    // The mutant this pins: `if ("ok" in verdict)` instead of
    // `if ("ok" in verdict && verdict.ok)` makes an unparseable or sha-less
    // version.json a PASS — one token away from a silently green deploy gate.
    for (const [body, reason] of [
      ["<html>404</html>", /not JSON/],
      ['{"builtAt":"x"}', /no 'sha'/],
    ] as const) {
      const pages = healthySite(SHA);
      pages["version.json"] = { status: 200, body, contentType: "application/json" };
      const { get } = serve(pages);
      const out = await runDeployCheck(
        memoryIO(),
        { get, wait: noWait },
        { sha: SHA, base: BASE, attempts: 2 },
      );
      expect(out.ok, body).toBe(false);
      expect(out.results[0].detail, body).toMatch(reason);
      expect(out.results[0].detail, body).not.toBe("never checked");
    }
  });

  it("RETRIES a thrown transport error — the one CDN symptom a budget must absorb", async () => {
    // undici throws on a connection reset mid-turnover. Abandoning the whole
    // run there failed main's deploy gate for the most transient cause there
    // is, and never checked the surface at all.
    let calls = 0;
    const pages = healthySite(SHA);
    const get = async (url: string): Promise<Fetched> => {
      if (url.includes("version.json")) {
        calls++;
        if (calls <= 2) throw new Error("ECONNRESET");
        return {
          status: 200,
          body: versionFile(SHA, "x", SAMPLE_PATHS),
          contentType: "application/json",
        };
      }
      return pages[url.slice(BASE.length).replace(/\?.*$/, "")]!;
    };
    const out = await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(out.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("reports a transport error that never clears, naming it", async () => {
    const pages = healthySite(SHA);
    const get = async (url: string): Promise<Fetched> => {
      if (url.includes("version.json")) throw new Error("ENOTFOUND");
      return pages[url.slice(BASE.length).replace(/\?.*$/, "")]!;
    };
    const out = await runDeployCheck(
      memoryIO(),
      { get, wait: noWait },
      { sha: SHA, base: BASE, attempts: 2 },
    );
    expect(out.ok).toBe(false);
    expect(out.results[0].detail).toMatch(/ENOTFOUND/);
    // The surface was still checked — one flaky endpoint must not hide the rest.
    // version + the surface + ONE "not run" for the structured-data sample: it
    // never runs against a site not serving this build (spec 44 R1).
    expect(out.results.length).toBe(DEPLOY_SURFACE.length + 1 + 1);
  });

  it("FAILS on a missing version.json rather than skipping the check", async () => {
    const pages = healthySite(SHA);
    delete pages["version.json"];
    const { get } = serve(pages);
    const out = await runDeployCheck(
      memoryIO(),
      { get, wait: noWait },
      { sha: SHA, base: BASE, attempts: 2 },
    );
    expect(out.ok).toBe(false);
    expect(out.results[0].detail).toMatch(/404/);
  });

  it("FAILS when a generated trek page 404s, even with the right version", async () => {
    const pages = healthySite(SHA);
    delete pages["t/skandagiri/"];
    const { get } = serve(pages);
    const out = await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(out.ok).toBe(false);
    expect(out.results.find((r) => r.path === "t/skandagiri/")!.ok).toBe(false);
  });

  it("FAILS on a soft 404 — the app shell served where a page should be", async () => {
    const pages = healthySite(SHA);
    pages["sources/"] = {
      status: 200,
      body: '<div id="root"></div>',
      contentType: "text/html",
    };
    const { get } = serve(pages);
    const out = await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(out.ok).toBe(false);
  });

  it("survives a page that throws, reporting it rather than aborting the run", async () => {
    const pages = healthySite(SHA);
    const { get } = serve(pages);
    const flaky = async (url: string): Promise<Fetched> => {
      if (url.endsWith("robots.txt")) throw new Error("ECONNRESET");
      return get(url);
    };
    const out = await runDeployCheck(
      memoryIO(),
      { get: flaky, wait: noWait },
      { sha: SHA, base: BASE },
    );
    expect(out.ok).toBe(false);
    // Every other page was still checked — one failure must not hide the rest.
    // version + the surface + the structured-data sample (spec 44 R1)
    expect(out.results.length).toBe(DEPLOY_SURFACE.length + 1 + SAMPLE_PATHS.length);
  });

  it("cache-busts the version request so a CDN cannot answer with our own check", async () => {
    const { get, asked } = serve(healthySite(SHA));
    await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(asked[0]).toMatch(/version\.json\?cb=/);
  });

  it("normalises a base URL given without its trailing slash", async () => {
    const { get } = serve(healthySite(SHA));
    const out = await runDeployCheck(
      memoryIO(),
      { get, wait: noWait },
      { sha: SHA, base: BASE.replace(/\/$/, "") },
    );
    expect(out.ok).toBe(true);
  });

  describe("structured-data sample (spec 44 R1)", () => {
    const run = (pages: Record<string, Fetched>) =>
      runDeployCheck(memoryIO(), { get: serve(pages).get, wait: noWait }, { sha: SHA, base: BASE });
    const sampled = (out: { results: { path: string }[] }) =>
      out.results.filter((r) => SAMPLE_PATHS.includes(r.path)).map((r) => r.path);

    it("checks every page the build listed in version.json, cache-busted", async () => {
      const { get, asked } = serve(healthySite(SHA));
      const out = await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
      expect(out.ok).toBe(true);
      expect(sampled(out)).toEqual(SAMPLE_PATHS);
      for (const p of SAMPLE_PATHS) {
        const hit = asked.filter((u) => u.includes(`/${p}`));
        expect(hit).toHaveLength(1);
        expect(hit[0]).toContain(`?cb=${SHA}-`);
      }
    });

    it("FAILS when a page's JSON-LD url is not its canonical — the 3,815-page defect", async () => {
      const pages = healthySite(SHA);
      pages["t/virapuli/"] = trekPage(
        "virapuli",
        "d12-2928-1951-105-136",
        absoluteUrl("t/d12-2928-1951-105-136/"),
      );
      const out = await run(pages);
      expect(out.ok).toBe(false);
      expect(out.results.find((r) => r.path === "t/virapuli/")?.detail).toMatch(
        /JSON-LD url .* is not the canonical/,
      );
    });

    it("FAILS a page whose canonical and JSON-LD agree on the wrong url", async () => {
      const pages = healthySite(SHA);
      const wrong = absoluteUrl("t/gn-11022928/");
      pages["t/kumara-parvatha/"] = {
        status: 200,
        contentType: "text/html",
        body: `<link rel="canonical" href="${wrong}" /><script type="application/ld+json">{"url":"${wrong}"}</script>`,
      };
      const out = await run(pages);
      expect(out.results.find((r) => r.path === "t/kumara-parvatha/")?.detail).toMatch(
        /is not this page's url/,
      );
      expect(out.ok).toBe(false);
    });

    it("FAILS a page it cannot read, naming why", async () => {
      for (const [page, reason] of [
        [{ status: 404, body: "", contentType: "text/html" }, /HTTP 404/],
        [{ status: 200, body: "<h1>x</h1>", contentType: "text/html" }, /no canonical/],
        [
          {
            status: 200,
            body: `<link rel="canonical" href="${absoluteUrl("t/virapuli/")}" />`,
            contentType: "text/html",
          },
          /no JSON-LD url/,
        ],
      ] as const) {
        const pages = healthySite(SHA);
        pages["t/virapuli/"] = page;
        const out = await run(pages);
        expect(out.results.find((r) => r.path === "t/virapuli/")?.detail, String(reason)).toMatch(
          reason,
        );
        expect(out.ok).toBe(false);
      }
    });

    it("FAILS when version.json lists no sample — a build that chose none is not verified", async () => {
      const pages = healthySite(SHA);
      pages["version.json"] = {
        status: 200,
        body: versionFile(SHA, "x", []),
        contentType: "application/json",
      };
      const out = await run(pages);
      expect(out.results.find((r) => r.path === "JSON-LD sample")?.detail).toBe(
        "version.json lists no jsonLdSample",
      );
      expect(out.ok).toBe(false);
    });

    it("does not run against a site that is not serving the build just made", async () => {
      const { get, asked } = serve(healthySite("c".repeat(40)));
      const out = await runDeployCheck(
        memoryIO(),
        { get, wait: noWait },
        { sha: SHA, base: BASE, attempts: 1 },
      );
      expect(out.results.find((r) => r.path === "JSON-LD sample")?.detail).toBe(
        "not run — the site is not serving the build just made",
      );
      expect(asked.some((u) => SAMPLE_PATHS.some((p) => u.includes(`/${p}`)))).toBe(false);
    });

    it("retries a sampled page once on a thrown request, a 5xx, a 408 or a 429", async () => {
      for (const transient of ["throw", 503, 408, 429] as const) {
        const { get } = serve(healthySite(SHA));
        let calls = 0;
        const flaky = async (url: string): Promise<Fetched> => {
          if (url.includes("/t/virapuli/") && calls++ === 0) {
            if (transient === "throw") throw new Error("ECONNRESET");
            return { status: transient, body: "", contentType: "text/html" };
          }
          return get(url);
        };
        const out = await runDeployCheck(
          memoryIO(),
          { get: flaky, wait: noWait },
          { sha: SHA, base: BASE },
        );
        expect(calls, String(transient)).toBe(2);
        expect(out.results.find((r) => r.path === "t/virapuli/")?.ok, String(transient)).toBe(true);
      }
    });

    it("does NOT retry a 404 — it is not transient", async () => {
      const pages = healthySite(SHA);
      pages["t/virapuli/"] = { status: 404, body: "", contentType: "text/html" };
      const { get, asked } = serve(pages);
      await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
      expect(asked.filter((u) => u.includes("/t/virapuli/"))).toHaveLength(1);
    });
  });
});

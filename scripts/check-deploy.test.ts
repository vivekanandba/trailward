import { describe, it, expect } from "vitest";
import { runDeployCheck, type Fetched } from "./check-deploy";
import { memoryIO } from "./lib/buildIO";
import { versionFile, DEPLOY_SURFACE } from "./lib/deploycheck";

const SHA = "a".repeat(40);
const PREV = "b".repeat(40);
const BASE = "https://example.test/trailward/";

/** A site that serves everything correctly at `sha`. */
function healthySite(sha: string): Record<string, Fetched> {
  const pages: Record<string, Fetched> = {
    "version.json": { status: 200, body: versionFile(sha, "x"), contentType: "application/json" },
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
          body: versionFile(call <= 2 ? PREV : SHA, "x"),
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
        ? { status: 200, body: versionFile(PREV, "x"), contentType: "application/json" }
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
        return { status: 200, body: versionFile("c".repeat(40), "x"), contentType: "" };
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
          body: versionFile(calls <= 2 ? PREV : SHA, "x"),
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
          : { status: 200, body: versionFile(SHA, "x"), contentType: "application/json" };
      }
      return pages[url.slice(BASE.length).replace(/\?.*$/, "")]!;
    };
    const out = await runDeployCheck(memoryIO(), { get, wait: noWait }, { sha: SHA, base: BASE });
    expect(out.ok).toBe(true);
    expect(calls).toBe(3);
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
    expect(out.results.length).toBe(DEPLOY_SURFACE.length + 1);
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
});

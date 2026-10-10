/**
 * Delivery-path verification (spec 42 §B).
 *
 * CON-COV-001 says: after deploying, assert the running version equals the
 * version just built. Nothing here did that — the deploy was the one step with
 * no gate at all, on a project whose entire output IS the deployed site.
 *
 * The pure parts live here so the decision logic is tested rather than only
 * exercised by a workflow that runs after a merge.
 */

export interface VersionFile {
  /** The commit this build came from. */
  sha: string;
  /** ISO timestamp, for a human reading the file. Never compared. */
  builtAt: string;
}

export function versionFile(sha: string, builtAt: string): string {
  return `${JSON.stringify({ sha, builtAt } satisfies VersionFile, null, 2)}\n`;
}

export type LiveCheck =
  | { ok: true; detail: string }
  /** The deployed site is not what was built. Fail the job. */
  | { ok: false; detail: string }
  /** The CDN has not turned over yet. Retry — this is not a failure. */
  | { stale: true; detail: string };

/**
 * Compare the live version.json against the SHA just built.
 *
 * A sha that does not match is RETRYABLE; a malformed answer is not.
 *
 * The CDN takes a moment to turn over, and in that window almost every "wrong
 * sha" is really "not yet" — so any non-matching sha returns `stale` and the
 * caller retries it to a bounded budget before failing. Requiring the previous
 * sha to earn that retry did not work: `workflow_dispatch` carries none, and a
 * cancelled run leaves the site older than the one it would name.
 *
 * What is NOT retryable-into-a-pass: a body that is not JSON, or one with no
 * `sha`. Those are failures however long you wait, and a missing file is never
 * a skip — that is how an unverified deploy passes for green (CON-DATA-002).
 */
export function checkDeployedVersion(
  body: string,
  expectedSha: string,
  previousSha?: string,
): LiveCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, detail: `version.json is not JSON: ${body.slice(0, 80)}` };
  }
  const sha = (parsed as { sha?: unknown })?.sha;
  if (typeof sha !== "string" || sha.length === 0) {
    return { ok: false, detail: "version.json carries no 'sha'" };
  }
  if (sha === expectedSha) return { ok: true, detail: `serving ${sha.slice(0, 8)}` };
  if (previousSha && sha === previousSha) {
    return { stale: true, detail: `still serving the previous build ${sha.slice(0, 8)}` };
  }
  // ANY other sha is treated as possibly-stale and retried, rather than failed
  // outright. The previous sha is often unknown — workflow_dispatch has no
  // `github.event.before`, and a run cancelled by the concurrency group leaves
  // the live site older than it — and in every one of those cases the likeliest
  // explanation of "a different sha" is still CDN lag. Requiring previousSha
  // to earn a retry disabled the whole budget silently and reported "something
  // else is deployed" for what was usually "not yet" (CON-VER-005). The retry
  // is bounded, so a genuine mismatch still fails, just not on attempt one.
  return {
    stale: true,
    detail: `serving ${sha.slice(0, 8)}, expected ${expectedSha.slice(0, 8)}`,
  };
}

export interface PageExpectation {
  path: string;
  /** A substring the body must contain, proving it is the page and not a 404. */
  contains?: string;
  /** A substring the content-type must contain. */
  contentType?: string;
}

/**
 * The surface a deploy must actually serve. Each entry is something a real
 * visitor or crawler asks for, and each has been broken at least once by a
 * build-path change: the base path, the generated pages, the crawl files.
 */
export const DEPLOY_SURFACE: PageExpectation[] = [
  { path: "", contains: '<div id="root"', contentType: "text/html" },
  { path: "sitemap.xml", contains: "<urlset", contentType: "xml" },
  { path: "robots.txt", contains: "Sitemap:", contentType: "text/plain" },
  { path: "t/skandagiri/", contains: "Skandagiri", contentType: "text/html" },
  { path: "sources/", contains: "<h1", contentType: "text/html" },
  { path: "about/", contains: "<h1", contentType: "text/html" },
  { path: "data/", contains: "<h1", contentType: "text/html" },
];

export interface PageResult {
  path: string;
  status: number;
  ok: boolean;
  detail: string;
}

/** Judge one fetched page against its expectation. */
export function checkPage(
  expect: PageExpectation,
  status: number,
  body: string,
  contentType = "",
): PageResult {
  const path = expect.path || "/";
  if (status !== 200) {
    return { path, status, ok: false, detail: `HTTP ${status}` };
  }
  if (expect.contentType && !contentType.toLowerCase().includes(expect.contentType)) {
    return { path, status, ok: false, detail: `content-type ${contentType || "(none)"}` };
  }
  if (expect.contains && !body.includes(expect.contains)) {
    // A soft 404 — a 200 serving the SPA shell where a generated page should
    // be — looks fine to a status check and is invisible to a crawler check.
    return { path, status, ok: false, detail: `body does not contain ${expect.contains}` };
  }
  return { path, status, ok: true, detail: "ok" };
}

export function summariseDeploy(results: PageResult[]): { failed: PageResult[]; text: string } {
  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "ok  " : "FAIL"}  ${r.path} — ${r.detail}`);
  return {
    failed,
    text: [`${results.length - failed.length}/${results.length} ok`, "", ...lines].join("\n"),
  };
}

/** What a generated trek page says about itself (spec 44 R1). */
export interface TrekPageFacts {
  /** `<link rel="canonical">` — where the page says it lives. */
  canonical?: string;
  /** The JSON-LD `url` — where the page tells search engines it lives. */
  jsonLdUrl?: string;
  /** The record id, from the "Open on the map" `?sel=` link. */
  selId?: string;
}

const unescapeHtml = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * Read the three facts R1 compares out of a page's HTML. Each is undefined when
 * the page lacks it — never a guess — so the caller can say WHICH is missing.
 */
export function parseTrekPage(html: string): TrekPageFacts {
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  let jsonLdUrl: string | undefined;
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (ld) {
    try {
      const url = (JSON.parse(ld) as { url?: unknown }).url;
      if (typeof url === "string") jsonLdUrl = url;
    } catch {
      // Unparseable structured data is absent structured data.
    }
  }
  const sel = /[?&]sel=([^"&#]+)/.exec(html)?.[1];
  return {
    canonical: canonical === undefined ? undefined : unescapeHtml(canonical),
    jsonLdUrl,
    selId: sel === undefined ? undefined : decodeURIComponent(unescapeHtml(sel)),
  };
}

/** The `/t/<slug>/` pages a sitemap lists, as base-relative paths, in order. */
export function sitemapTrekPaths(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>[^<]*?\/(t\/[^/<]+\/)<\/loc>/g)) out.push(m[1]);
  return out;
}

/** How many qualifying pages the live backstop checks, and how far it looks. */
export const JSONLD_SAMPLE = 3;
export const JSONLD_WALK_LIMIT = 50;

/**
 * Judge one sampled page. `null` means the page cannot show the defect (its
 * slug equals its id) and is walked past — the ONLY case that is not a result.
 * Anything unreadable is a failure naming what is missing, never a skip: a
 * skip would make the sample look smaller than it is.
 */
export function checkJsonLdPage(path: string, status: number, body: string): PageResult | null {
  if (status !== 200) return { path, status, ok: false, detail: `JSON-LD sample: HTTP ${status}` };
  const page = parseTrekPage(body);
  if (!page.selId) return { path, status, ok: false, detail: "JSON-LD sample: no ?sel= link" };
  const slug = path.replace(/^t\//, "").replace(/\/$/, "");
  if (page.selId === slug) return null;
  if (!page.canonical) return { path, status, ok: false, detail: "JSON-LD sample: no canonical" };
  if (!page.jsonLdUrl) return { path, status, ok: false, detail: "JSON-LD sample: no JSON-LD url" };
  if (page.jsonLdUrl !== page.canonical) {
    return {
      path,
      status,
      ok: false,
      detail: `JSON-LD url ${page.jsonLdUrl} is not the canonical ${page.canonical}`,
    };
  }
  return { path, status, ok: true, detail: "JSON-LD url is the canonical" };
}

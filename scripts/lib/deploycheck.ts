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

import { unescapeHtml } from "./trekPage";

export interface VersionFile {
  /** The commit this build came from. */
  sha: string;
  /** ISO timestamp, for a human reading the file. Never compared. */
  builtAt: string;
  /**
   * Pages the live structured-data check samples (spec 44 R1), chosen by the
   * build, which knows which slugs differ from their ids. Shipped in this file
   * because it is fetched cache-busted and pinned to the sha just built, so the
   * sample can never come from a different build than the pages it checks.
   */
  jsonLdSample: string[];
}

export function versionFile(sha: string, builtAt: string, jsonLdSample: string[]): string {
  return `${JSON.stringify({ sha, builtAt, jsonLdSample } satisfies VersionFile, null, 2)}\n`;
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
}

/**
 * Read the two facts R1 compares out of a page's HTML. Each is undefined when
 * the page lacks it — never a guess — so the caller can say WHICH is missing.
 * Attribute values are HTML-escaped by renderTrekPage (`esc`), so they are
 * unescaped with its exact inverse.
 */
export function parseTrekPage(html: string): TrekPageFacts {
  // Any attribute order: a renderer that writes href before rel is not a page
  // without a canonical, and must not be reported as one (CON-VER-005).
  const link = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(html)?.[0];
  const canonical = link ? /\bhref="([^"]+)"/.exec(link)?.[1] : undefined;
  // Every ld+json block, not only the first: a BreadcrumbList placed ahead of
  // the TouristAttraction is not a page without one.
  let jsonLdUrl: string | undefined;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const ld = JSON.parse(m[1]) as { "@type"?: unknown; url?: unknown };
      if (ld["@type"] === "TouristAttraction" && typeof ld.url === "string") jsonLdUrl = ld.url;
    } catch {
      // Unparseable structured data is absent structured data.
    }
  }
  return { canonical: canonical === undefined ? undefined : unescapeHtml(canonical), jsonLdUrl };
}

/**
 * R1's judgement, shared by the build (every page, every build) and the live
 * check. `expectedUrl` is the full URL the page must live at. The canonical
 * must BE that url, not merely end in the right path: a doubled base path or a
 * wrong host also 404s. And the JSON-LD url must be the canonical. Checking
 * only that the two agree would pass a page where both name a url that 404s.
 */
export function jsonLdProblem(expectedUrl: string, page: TrekPageFacts): string | null {
  if (!page.canonical) return "no canonical";
  if (!page.jsonLdUrl) return "no JSON-LD url";
  if (page.canonical !== expectedUrl) {
    return `canonical ${page.canonical} is not this page's url ${expectedUrl}`;
  }
  if (page.jsonLdUrl !== page.canonical) {
    return `JSON-LD url ${page.jsonLdUrl} is not the canonical ${page.canonical}`;
  }
  return null;
}

export interface SampleCandidate {
  id: string;
  slug: string;
  tier: string;
}

/** The kinds of page the live sample covers, each named so a gap can be reported. */
const SAMPLE_KINDS: { kind: string; is: (p: SampleCandidate) => boolean }[] = [
  { kind: "curated", is: (p) => p.tier === "curated" },
  { kind: "collision-suffixed", is: (p) => p.slug.endsWith(`-${p.id}`) },
  { kind: "gn-", is: (p) => p.id.startsWith("gn-") },
  { kind: "d12-", is: (p) => p.id.startsWith("d12-") },
  { kind: "osm-", is: (p) => p.id.startsWith("osm-") }, // not osmx-, a separate source
];

/**
 * The live check's sample: one page of each KIND whose slug differs from its
 * id, the only pages this defect can show on. A sample drawn from the head of
 * the sitemap is always the same few curated pages, so a regression limited to
 * generated or collision-suffixed pages would pass it. Deterministic: the first
 * of each kind in build order. A kind with no page has `path` undefined, so the
 * build can say the sample shrank rather than shrink it silently.
 */
export function sampleByKind(pages: SampleCandidate[]): { kind: string; path?: string }[] {
  const taken = new Set<string>();
  return SAMPLE_KINDS.map(({ kind, is }) => {
    const hit = pages.find((p) => p.slug !== p.id && is(p) && !taken.has(p.slug));
    if (!hit) return { kind };
    taken.add(hit.slug);
    return { kind, path: `t/${hit.slug}/` };
  });
}

export function pickJsonLdSample(pages: SampleCandidate[]): string[] {
  return sampleByKind(pages).flatMap((k) => (k.path ? [k.path] : []));
}

/** The sample a deployed version.json lists, or null when it lists none. */
export function sampleFromVersion(body: string): string[] | null {
  try {
    const sample = (JSON.parse(body) as { jsonLdSample?: unknown }).jsonLdSample;
    // Each entry must be a trek page path. An empty string would fetch the
    // site root and be judged as a page with no JSON-LD — the wrong diagnosis.
    return Array.isArray(sample) &&
      sample.length > 0 &&
      sample.every((p) => typeof p === "string" && /^t\/[^/]+\/$/.test(p))
      ? (sample as string[])
      : null;
  } catch {
    return null;
  }
}

/** Judge one sampled page against R1. */
export function checkJsonLdPage(
  path: string,
  expectedUrl: string,
  status: number,
  body: string,
): PageResult {
  if (status !== 200) return { path, status, ok: false, detail: `JSON-LD sample: HTTP ${status}` };
  const problem = jsonLdProblem(expectedUrl, parseTrekPage(body));
  return problem
    ? { path, status, ok: false, detail: problem }
    : { path, status, ok: true, detail: "JSON-LD url is the canonical" };
}

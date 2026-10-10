/**
 * check-deploy — after a deploy, assert the LIVE site serves the version just
 * built (spec 42 §B, CON-COV-001).
 *
 *   npm run check:deploy -- --sha <commit> [--url https://…/trailward/]
 *
 * This is the gate the delivery path never had. Unlike the link and API
 * checks it is NOT advisory: a site serving something other than what CI built
 * is a broken deploy, and the whole product is the deployed site.
 */
import { pathToFileURL } from "node:url";
import { request } from "undici";
import { nodeIO, type BuildIO } from "./lib/buildIO";
import { absoluteUrl } from "../src/lib/seo";
import {
  DEPLOY_SURFACE,
  checkDeployedVersion,
  checkJsonLdPage,
  checkPage,
  sampleFromVersion,
  summariseDeploy,
  type PageResult,
} from "./lib/deploycheck";

const SITE = "https://vivekanandba.github.io/trailward/";
const UA = "TrailwardBot/0.1 (+https://github.com/vivekanandba/trailward; deploy check)";

export interface Fetched {
  status: number;
  body: string;
  contentType: string;
}

export interface DeployDeps {
  get: (url: string) => Promise<Fetched>;
  /** Injected so the retry loop is testable without real time passing. */
  wait: (ms: number) => Promise<void>;
}

export interface DeployOptions {
  sha: string;
  previousSha?: string;
  base?: string;
  /** How many times to re-ask while the CDN is still serving the old build. */
  attempts?: number;
  waitMs?: number;
}

export async function runDeployCheck(
  io: BuildIO,
  deps: DeployDeps,
  opts: DeployOptions,
): Promise<{ ok: boolean; results: PageResult[] }> {
  const base = (opts.base ?? SITE).replace(/\/?$/, "/");
  const attempts = opts.attempts ?? 6;

  // 1. The version, with a bounded retry. Cache-busted: a CDN serving us a
  //    cached copy of our own check would make this assert nothing.
  let versionDetail = "never checked";
  let versionOk = false;
  let versionBody = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // EVERY outcome sets `versionDetail`, including the thrown one. Leaving a
    // path that does not means the final report reads "never checked" for a
    // case that was in fact diagnosed exactly — sending whoever reads the
    // failed deploy after a problem that does not exist (CON-VER-005).
    try {
      const { status, body } = await deps.get(`${base}version.json?cb=${opts.sha}-${attempt}`);
      if (status !== 200) {
        // A missing version.json is a FAILURE, not a skip — that is exactly
        // how an unverified deploy would pass for green. Still retried: the
        // deploy may not have landed yet.
        versionDetail = `version.json returned HTTP ${status}`;
      } else {
        const verdict = checkDeployedVersion(body, opts.sha, opts.previousSha);
        versionDetail = verdict.detail;
        if ("ok" in verdict && verdict.ok) {
          versionOk = true;
          versionBody = body;
          break;
        }
      }
    } catch (err) {
      // A transport error is the ONE symptom of a CDN mid-turnover that the
      // budget cannot absorb if it aborts here — and undici throws exactly
      // this in that window. Retrying a 404 while abandoning a reset would
      // fail main's deploy gate for the most transient cause there is.
      versionDetail = `version.json request failed: ${(err as Error).message}`;
    }
    io.log(`[deploy] attempt ${attempt}/${attempts}: ${versionDetail}`);
    if (attempt < attempts) await deps.wait(opts.waitMs ?? 10_000);
  }

  const results: PageResult[] = [
    { path: "version.json", status: versionOk ? 200 : 0, ok: versionOk, detail: versionDetail },
  ];

  // 2. The surface itself: the app shell, the crawl files, a generated trek
  //    page and the content pages. A 200 is not enough — each must carry
  //    something proving it is the page and not the SPA shell served as a
  //    soft 404.
  for (const expectation of DEPLOY_SURFACE) {
    const url = `${base}${expectation.path}`;
    try {
      const { status, body, contentType } = await deps.get(url);
      results.push(checkPage(expectation, status, body, contentType));
    } catch (err) {
      results.push({
        path: expectation.path || "/",
        status: 0,
        ok: false,
        detail: (err as Error).message,
      });
    }
  }

  // 3. Structured data (spec 44 R1). The fixed sample above has slug == id, so
  //    it could never see a JSON-LD url built from the id. The build lists one
  //    page of each kind whose slug differs, in the version.json just verified —
  //    so the sample is from this build, and only ever from it.
  results.push(...(await checkJsonLdSample(deps, base, opts.sha, versionOk, versionBody)));

  const { failed, text } = summariseDeploy(results);
  io.log(text);
  return { ok: failed.length === 0, results };
}

async function checkJsonLdSample(
  deps: DeployDeps,
  base: string,
  sha: string,
  versionOk: boolean,
  versionBody: string,
): Promise<PageResult[]> {
  const summary = (detail: string): PageResult[] => [
    { path: "JSON-LD sample", status: 0, ok: false, detail },
  ];
  // Pages from an older build would report THAT build's defects as this one's.
  if (!versionOk) return summary("not run — the site is not serving the build just made");
  const sample = sampleFromVersion(versionBody);
  if (!sample) return summary("version.json lists no jsonLdSample");
  const out: PageResult[] = [];
  for (const path of sample) {
    // The canonical must be the PRODUCTION url of this page — that is what
    // search engines are told — whatever host this check was pointed at.
    out.push(await fetchAndJudge(deps, base, sha, path, absoluteUrl(path)));
  }
  return out;
}

/** Statuses worth one more try: the CDN mid-turnover, or rate limiting. */
const TRANSIENT = (status: number): boolean => status >= 500 || status === 408 || status === 429;

/**
 * One sampled page, retried once on a transient failure (a thrown request, a
 * 5xx, 408 or 429). A 404 or a wrong url is not transient and is judged at once.
 * Cache-busted like version.json: right after a deploy the CDN may still hold
 * the previous build's page, which is not this defect (CON-VER-005).
 */
async function fetchAndJudge(
  deps: DeployDeps,
  base: string,
  sha: string,
  path: string,
  expectedUrl: string,
): Promise<PageResult> {
  let last: PageResult = { path, status: 0, ok: false, detail: "JSON-LD sample: never fetched" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { status, body } = await deps.get(`${base}${path}?cb=${sha}-${attempt}`);
      last = checkJsonLdPage(path, expectedUrl, status, body);
      if (!TRANSIENT(status)) return last;
    } catch (err) {
      last = { path, status: 0, ok: false, detail: `JSON-LD sample: ${(err as Error).message}` };
    }
    if (attempt === 1) await deps.wait(2_000);
  }
  return last;
}

async function get(url: string): Promise<Fetched> {
  const res = await request(url, {
    headers: { "user-agent": UA, "cache-control": "no-cache" },
    headersTimeout: 20_000,
    bodyTimeout: 20_000,
  });
  return {
    status: res.statusCode,
    body: await res.body.text(),
    contentType: String(res.headers["content-type"] ?? ""),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = arg("sha") ?? process.env.GITHUB_SHA;
  if (!sha) {
    console.error("[deploy] --sha (or GITHUB_SHA) is required");
    process.exit(1);
  }
  runDeployCheck(
    nodeIO,
    { get, wait: (ms) => new Promise((r) => setTimeout(r, ms)) },
    {
      sha,
      // `||` not `??`: workflow_dispatch supplies an EMPTY string here, and an
      // empty previous sha must read as "unknown", not as a value.
      previousSha: arg("previous") || process.env.PREVIOUS_SHA || undefined,
      base: arg("url"),
    },
  )
    .then((r) => {
      if (!r.ok) {
        console.error("[deploy] the live site does not match what was built");
        process.exit(1);
      }
      console.log("[deploy] live site verified");
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[deploy] check failed: ${(err as Error).message}`);
      process.exit(1);
    });
}

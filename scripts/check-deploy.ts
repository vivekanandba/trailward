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
import {
  DEPLOY_SURFACE,
  checkDeployedVersion,
  checkPage,
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
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { status, body } = await deps.get(`${base}version.json?cb=${opts.sha}-${attempt}`);
    if (status !== 200) {
      // A missing version.json is a FAILURE, not a skip — that is exactly how
      // an unverified deploy would pass for green.
      versionDetail = `version.json returned HTTP ${status}`;
    } else {
      const verdict = checkDeployedVersion(body, opts.sha, opts.previousSha);
      if ("ok" in verdict && verdict.ok) {
        versionOk = true;
        versionDetail = verdict.detail;
        break;
      }
      if ("stale" in verdict) {
        versionDetail = verdict.detail;
        io.log(`[deploy] attempt ${attempt}/${attempts}: ${verdict.detail}`);
        if (attempt < attempts) {
          await deps.wait(opts.waitMs ?? 10_000);
          continue;
        }
      }
    }
    if (attempt < attempts && !versionOk) await deps.wait(opts.waitMs ?? 10_000);
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

  const { failed, text } = summariseDeploy(results);
  io.log(text);
  return { ok: failed.length === 0, results };
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

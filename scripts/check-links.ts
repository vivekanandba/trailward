/**
 * check-links — the network shell around lib/linkcheck (spec 37).
 *
 * Advisory by design: it exits 0 even when links fail, because a third
 * party's outage must not block a merge. But an advisory step that merely goes
 * green is useless — nobody reads a passing log — so it writes its summary to
 * $GITHUB_STEP_SUMMARY where it is actually visible.
 *
 *   npm run check:links            # sample the dataset's source URLs
 *   npm run check:links -- --all   # every distinct URL (slow)
 */
import { appendFileSync } from "node:fs";
import { nodeIO, type BuildIO } from "./lib/buildIO";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { classifyLink, summarise, type Result } from "./lib/linkcheck";

const here = dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;
// Some hosts reject default agents outright; a browser UA says nothing about
// us and gets an honest answer.
const UA =
  "Mozilla/5.0 (compatible; TrailwardLinkCheck/1.0; +https://vivekanandba.github.io/trailward/)";

/** Distinct external URLs referenced by the dataset and the content pages. */
export function collectUrls(treks: Trek[], contentSources: string[]): string[] {
  const urls = new Set<string>();
  for (const t of treks) {
    for (const s of t.sources ?? []) if (s.startsWith("https://")) urls.add(s);
    if (t.image?.url?.startsWith("https://")) urls.add(t.image.url);
    if (t.historicalNote?.url?.startsWith("https://")) urls.add(t.historicalNote.url);
  }
  for (const src of contentSources) {
    for (const m of src.matchAll(/https:\/\/[^\s)"'<>]+/g)) urls.add(m[0].replace(/[.,]$/, ""));
  }
  return [...urls];
}

/** One distinct host per URL family keeps a sample representative. */
export function sampleByHost(urls: string[], perHost: number): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      continue;
    }
    const n = seen.get(host) ?? 0;
    if (n >= perHost) continue;
    seen.set(host, n + 1);
    out.push(u);
  }
  return out;
}

export async function probe(url: string, doFetch: typeof fetch = fetch): Promise<Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await doFetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA },
    });
    // Plenty of hosts don't implement HEAD properly; fall back to GET.
    if (res.status === 405 || res.status === 501) {
      res = await doFetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": UA },
      });
    }
    const outcome = classifyLink({ url, finalUrl: res.url, status: res.status });
    return { url, outcome, status: res.status, finalUrl: res.url };
  } catch (err) {
    return {
      url,
      outcome: classifyLink({ url, finalUrl: "", status: 0, error: String(err) }),
      status: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface LinkCheckDeps {
  probe: (url: string) => Promise<Result>;
  /** Appends the run's report to the CI step summary, when there is one. */
  writeSummary?: (text: string) => void;
}

export async function runCheckLinks(
  io: BuildIO,
  root: string,
  deps: LinkCheckDeps,
  all = false,
): Promise<{ urls: number; checked: number; exitCode: number; text: string }> {
  const r = root.replace(/\/+$/, "");
  const treks = JSON.parse(io.readFile(`${r}/src/data/treks.json`)) as Trek[];
  // Derived, never a second hardcoded list: with ["about.md","sources.md"]
  // written out here, deleting content/about.md broke this and adding
  // content/faq.md meant its external links were never probed — which is
  // exactly the link rot this job exists to catch.
  const contentDir = `${r}/content`;
  const content = io
    .listDir(contentDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => io.readFile(`${contentDir}/${f}`));

  const urls = collectUrls(treks, content);
  const targets = all ? urls : sampleByHost(urls, 8);
  io.log(`[links] ${urls.length} distinct URL(s); checking ${targets.length}…`);

  const results: Result[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    results.push(...(await Promise.all(targets.slice(i, i + CONCURRENCY).map(deps.probe))));
  }

  const report = summarise(results);
  io.log(report.text);
  deps.writeSummary?.(report.text);
  return {
    urls: urls.length,
    checked: targets.length,
    exitCode: report.exitCode,
    text: report.text,
  };
}

// Only run when invoked as a CLI — importing this module (tests) must not
// hit the network, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCheckLinks(
    nodeIO,
    resolve(here, ".."),
    {
      probe: (url) => probe(url),
      writeSummary: (text) => {
        const summaryFile = process.env.GITHUB_STEP_SUMMARY;
        if (summaryFile) {
          appendFileSync(
            summaryFile,
            `### External link check\n\n\`\`\`\n${text}\n\`\`\`\n`,
            "utf8",
          );
        }
      },
    },
    process.argv.includes("--all"),
  )
    .then((r) => process.exit(r.exitCode))
    .catch((err) => {
      console.error((err as Error).message);
      process.exit(0); // advisory even on an internal error
    });
}

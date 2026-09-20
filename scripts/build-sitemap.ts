/**
 * build-sitemap — emits public/sitemap.xml (spec 35). Runs in the same
 * prebuild step as build:chunks, so the crawl surface can never drift from the
 * data that backs it.
 *
 * `lastmod` comes from the DATA's own git history, not from build time: a page
 * whose facts did not change must not claim to have changed, or every rebuild
 * would invite a recrawl of everything.
 */
import { execFileSync } from "node:child_process";
import { nodeIO, type BuildIO } from "./lib/buildIO";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { sitemapXml, type SitemapEntry } from "../src/lib/seo";
import { qualifyingTreks, slugMap } from "./lib/pages";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const outFile = resolve(here, "../public/sitemap.xml");

/** ISO date of the last commit that touched a file, or undefined outside git. */
export function lastCommitDate(file: string, cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], {
      cwd,
      encoding: "utf8",
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Emits the sitemap. `lastmod` is injected so the output is deterministic. */
export function runBuildSitemap(
  io: BuildIO,
  paths: { treks: string; out: string },
  dataDate?: string,
): number {
  if (!io.exists(paths.treks)) throw new Error(`[sitemap] missing ${paths.treks}`);
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];

  const pages = qualifyingTreks(treks);
  const slugs = slugMap(pages);
  const entries: SitemapEntry[] = [
    { path: "/", lastmod: dataDate },
    // Content pages (spec 36) — authored markdown plus the generated /data/.
    ...["about", "sources", "data"].map((slug) => ({ path: `${slug}/`, lastmod: dataDate })),
  ];
  for (const t of pages) {
    entries.push({ path: `t/${slugs.get(t.id)!}/`, lastmod: dataDate });
  }

  io.writeFile(paths.out, sitemapXml(entries));
  io.log(`[sitemap] wrote ${entries.length} url(s) → ${paths.out}`);
  return entries.length;
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runBuildSitemap(
      nodeIO,
      { treks: treksFile, out: outFile },
      lastCommitDate("src/data/treks.json", resolve(here, "..")),
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

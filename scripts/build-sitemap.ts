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
import { contentSlugs, qualifyingTreks } from "./lib/pages";
import { SLUGS_FILE, readRegistry, slugsFromRegistry } from "./lib/slugs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const treksFile = resolve(repoRoot, "src/data/treks.json");
const outFile = resolve(repoRoot, "public/sitemap.xml");
const slugsFile = resolve(repoRoot, SLUGS_FILE);
const contentDir = resolve(repoRoot, "content");

/**
 * ISO date of the last commit that touched a file, or undefined outside git
 * or in a shallow clone. A shallow clone's only commit "touched" every file,
 * so it would give the checkout's date, not the data's: a 1-commit CI
 * checkout made every page claim data from the day of the deploy (spec 44 R5).
 * No date is better than a wrong one (CON-DATA-001).
 *
 * `TRAILWARD_DATA_DATE`, when set to a date, wins: the workflows read the date
 * with git in a plain step and pass it in, because inside Playwright's web
 * server on GitHub's runner git reported the full clone as shallow (the cause
 * was not found; a plain step in the same job saw it whole).
 */
export function lastCommitDate(
  file: string,
  cwd: string,
  git: (args: string[]) => string = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim(),
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const given = env.TRAILWARD_DATA_DATE;
  if (given && /^\d{4}-\d{2}-\d{2}$/.test(given)) return given;
  try {
    const shallow = git(["rev-parse", "--is-shallow-repository"]);
    if (shallow !== "false") {
      console.warn(`[dates] no data date: shallow clone (is-shallow-repository=${shallow})`);
      return undefined;
    }
    const out = git(["log", "-1", "--format=%cs", "--", file]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
    console.warn(`[dates] no data date: git log gave ${JSON.stringify(out.slice(0, 80))}`);
    return undefined;
  } catch (err) {
    console.warn(`[dates] no data date: ${(err as Error).message.split("\n")[0]}`);
    return undefined;
  }
}

/** Emits the sitemap. `lastmod` is injected so the output is deterministic. */
export function runBuildSitemap(
  io: BuildIO,
  paths: { treks: string; slugs: string; out: string },
  contentFiles: string[],
  dataDate?: string,
): number {
  if (!io.exists(paths.treks)) throw new Error(`[sitemap] missing ${paths.treks}`);
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];

  const pages = qualifyingTreks(treks);
  const slugs = slugsFromRegistry(
    pages,
    readRegistry(io.exists(paths.slugs) ? io.readFile(paths.slugs) : undefined),
  );
  const entries: SitemapEntry[] = [
    { path: "/", lastmod: dataDate },
    // Content pages (spec 36) — derived from the same listing build-pages
    // writes from, never a second hardcoded list that can drift out of step
    // with it (CON-COV-003: assert the agreement, don't restate it).
    ...contentSlugs(contentFiles).map((slug) => ({ path: `${slug}/`, lastmod: dataDate })),
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
      { treks: treksFile, slugs: slugsFile, out: outFile },
      nodeIO.listDir(contentDir),
      lastCommitDate("src/data/treks.json", repoRoot),
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

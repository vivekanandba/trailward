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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

async function main(): Promise<void> {
  if (!existsSync(treksFile)) throw new Error(`[sitemap] missing ${treksFile}`);
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const dataDate = lastCommitDate("src/data/treks.json", resolve(here, ".."));

  const pages = qualifyingTreks(treks);
  const slugs = slugMap(pages);
  const entries: SitemapEntry[] = [{ path: "/", lastmod: dataDate }];
  for (const t of pages) {
    entries.push({ path: `t/${slugs.get(t.id)!}/`, lastmod: dataDate });
  }

  writeFileSync(outFile, sitemapXml(entries), "utf8");
  console.log(`[sitemap] wrote ${entries.length} url(s) → ${outFile}`);
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

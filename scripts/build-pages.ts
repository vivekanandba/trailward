/**
 * build-pages — emits one static HTML page per qualifying trek (spec 35 §C)
 * into dist/t/<slug>/index.html. Runs AFTER vite build (postbuild), because
 * it writes into dist alongside the app.
 *
 * The output directory is cleaned first: records get scrubbed between builds
 * (spec 33), and a page for a record that no longer exists would be advertised
 * by the sitemap and 404 for a reader.
 */
import { nodeIO, type BuildIO } from "./lib/buildIO";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { GENERATED_CONTENT_SLUGS, cleanTargetFor, qualifyingTreks, slugMap } from "./lib/pages";
import { lastCommitDate } from "./build-sitemap";
import { renderTrekPage } from "./lib/trekPage";
import { parseFrontmatter, renderMarkdown } from "./lib/markdown";
import { dataPageMarkdown, datasetStats, renderContentPage } from "./lib/contentPage";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/**
 * Every path this tool touches is derived from the repo root, so no caller can
 * point its recursive clean at a directory of their choosing (CON-PROC-006).
 */
export function pagePathsFor(repoRoot: string): {
  treks: string;
  outDir: string;
  distDir: string;
  contentDir: string;
} {
  const root = repoRoot.replace(/\/+$/, "");
  return {
    treks: `${root}/src/data/treks.json`,
    outDir: cleanTargetFor(root),
    distDir: `${root}/dist`,
    contentDir: `${root}/content`,
  };
}

export function runBuildPages(
  io: BuildIO,
  repoRoot: string,
  contentFiles: string[],
  refreshed?: string,
): { treks: number; content: string[] } {
  const paths = pagePathsFor(repoRoot);
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];
  const pages = qualifyingTreks(treks);
  const slugs = slugMap(pages);

  // Slug uniqueness is load-bearing: a collision silently overwrites a page.
  if (new Set(slugs.values()).size !== pages.length) {
    throw new Error("[pages] slug collision — refusing to write");
  }

  io.removeDir(paths.outDir);
  for (const trek of pages) {
    const slug = slugs.get(trek.id)!;
    io.writeFile(`${paths.outDir}/${slug}/index.html`, renderTrekPage(trek, slug));
  }
  io.log(`[pages] wrote ${pages.length} trek page(s) → ${paths.outDir}`);

  // Content pages (spec 36). Authored markdown, plus a generated /data/ page.
  const written: string[] = [];
  const emit = (slug: string, src: string, file: string): void => {
    const { data, body } = parseFrontmatter(src, file);
    io.writeFile(
      `${paths.distDir}/${slug}/index.html`,
      renderContentPage(data, renderMarkdown(body, file), slug),
    );
    written.push(slug);
  };

  const authored = contentFiles.filter((f) => f.endsWith(".md")).sort();

  // A generated slug is not available to an author: content/data.md would be
  // rendered and then overwritten by the generated page below, so the authored
  // words vanish while the build reports success and the slug is listed twice.
  // Refuse instead — losing someone's writing silently is the worst outcome.
  for (const file of authored) {
    const slug = file.replace(/\.md$/, "");
    if ((GENERATED_CONTENT_SLUGS as readonly string[]).includes(slug)) {
      throw new Error(`[pages] ${file} collides with the generated /${slug}/ page — rename it`);
    }
  }
  if (authored.length === 0) {
    // An empty content/ means /about/ and /sources/ silently disappear from a
    // build that still exits 0 while the sitemap advertises them.
    throw new Error("[pages] no content/*.md found — refusing to ship a build without them");
  }

  for (const file of authored) {
    emit(file.replace(/\.md$/, ""), io.readFile(`${paths.contentDir}/${file}`), file);
  }

  const stats = datasetStats(treks, pages.length);
  emit(
    "data",
    [
      "---",
      "title: The dataset",
      `description: ${stats.total.toLocaleString("en-IN")} summits — counts, freshness, and how the data stays honest.`,
      "---",
      "",
      dataPageMarkdown(stats, refreshed),
    ].join("\n"),
    "data.md (generated)",
  );
  io.log(`[pages] wrote content page(s): ${written.join(", ")}`);
  return { treks: pages.length, content: written };
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const paths = pagePathsFor(repoRoot);
    if (!nodeIO.exists(paths.distDir)) {
      throw new Error("[pages] dist/ missing — run `npm run build` first");
    }
    runBuildPages(
      nodeIO,
      repoRoot,
      // listDir throws when content/ is absent, which is the point: a missing
      // content directory used to yield [] and ship a build with no /about/ or
      // /sources/ while the sitemap still advertised them.
      nodeIO.listDir(paths.contentDir),
      lastCommitDate("src/data/treks.json", repoRoot),
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

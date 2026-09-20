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
import { assertCleanTarget, qualifyingTreks, slugMap } from "./lib/pages";
import { lastCommitDate } from "./build-sitemap";
import { renderTrekPage } from "./lib/trekPage";
import { parseFrontmatter, renderMarkdown } from "./lib/markdown";
import { dataPageMarkdown, datasetStats, renderContentPage } from "./lib/contentPage";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const outDir = resolve(here, "../dist/t");
const contentDir = resolve(here, "../content");
const distDir = resolve(here, "../dist");

export interface PagePaths {
  treks: string;
  outDir: string;
  distDir: string;
  contentDir: string;
  repoRoot: string;
}

export function runBuildPages(
  io: BuildIO,
  paths: PagePaths,
  contentFiles: string[],
  refreshed?: string,
): { treks: number; content: string[] } {
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];
  const pages = qualifyingTreks(treks);
  const slugs = slugMap(pages);

  // Slug uniqueness is load-bearing: a collision silently overwrites a page.
  if (new Set(slugs.values()).size !== pages.length) {
    throw new Error("[pages] slug collision — refusing to write");
  }

  assertCleanTarget(paths.outDir, paths.repoRoot);
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

  for (const file of contentFiles.filter((f) => f.endsWith(".md")).sort()) {
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
    if (!nodeIO.exists(distDir)) {
      throw new Error("[pages] dist/ missing — run `npm run build` first");
    }
    runBuildPages(
      nodeIO,
      { treks: treksFile, outDir, distDir, contentDir, repoRoot: resolve(here, "..") },
      nodeIO.listDir(contentDir),
      lastCommitDate("src/data/treks.json", resolve(here, "..")),
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

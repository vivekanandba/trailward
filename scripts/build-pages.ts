/**
 * build-pages — emits one static HTML page per qualifying trek (spec 35 §C)
 * into dist/t/<slug>/index.html. Runs AFTER vite build (postbuild), because
 * it writes into dist alongside the app.
 *
 * The output directory is cleaned first: records get scrubbed between builds
 * (spec 33), and a page for a record that no longer exists would be advertised
 * by the sitemap and 404 for a reader.
 */
import { execFileSync } from "node:child_process";
import { nodeIO, type BuildIO } from "./lib/buildIO";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import {
  GENERATED_CONTENT_SLUGS,
  cleanTargetFor,
  contentSlugs,
  qualifyingTreks,
  slugMap,
} from "./lib/pages";
import { lastCommitDate } from "./build-sitemap";
import { renderTrekPage } from "./lib/trekPage";
import { parseFrontmatter, renderMarkdown } from "./lib/markdown";
import { dataPageMarkdown, datasetStats, renderContentPage } from "./lib/contentPage";
import { versionFile } from "./lib/deploycheck";

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
  buildSha = "unknown",
  buildTime = "unknown",
): { treks: number; content: string[] } {
  const paths = pagePathsFor(repoRoot);
  const treks = JSON.parse(io.readFile(paths.treks)) as Trek[];
  const pages = qualifyingTreks(treks);
  const slugs = slugMap(pages);

  // Slug uniqueness is load-bearing: a collision silently overwrites a page.
  if (new Set(slugs.values()).size !== pages.length) {
    throw new Error("[pages] slug collision — refusing to write");
  }

  // EVERYTHING that can refuse must run BEFORE the clean below. These checks
  // used to sit after it, so a refused build had already wiped dist/t and
  // rewritten the content pages — it exited 1 having half-rebuilt the tree,
  // and anything serving dist/ (vite preview, a manual gh-pages push) would
  // ship that. Refusing is only a safe outcome if nothing was destroyed yet.
  const authored = contentFiles.filter((f) => f.endsWith(".md")).sort();

  for (const file of authored) {
    const slug = file.replace(/\.md$/, "");
    // A slug is a directory name under dist/. An empty one (a file literally
    // named ".md") resolves to dist//index.html, which POSIX collapses onto
    // dist/index.html — silently replacing the SPA entry point, exit 0.
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`[pages] ${file} is not a usable page name — use lower-case-words.md`);
    }
    // A generated slug is not available to an author: content/data.md would be
    // rendered and then overwritten by the generated page below, so the
    // authored words vanish while the build reports success.
    // "t" is the trek-page directory, not a generated content page — so it
    // gets its own message rather than one that tells the author something
    // untrue about where the collision is.
    if (slug === "t") {
      throw new Error(`[pages] ${file} collides with the /t/ trek pages — rename it`);
    }
    if ((GENERATED_CONTENT_SLUGS as readonly string[]).includes(slug)) {
      throw new Error(`[pages] ${file} collides with the generated /${slug}/ page — rename it`);
    }
  }
  if (authored.length === 0) {
    // An empty content/ means /about/ and /sources/ silently disappear from a
    // build that still exits 0 while the sitemap advertises them.
    throw new Error("[pages] no content/*.md found — refusing to ship a build without them");
  }
  // RENDER every authored page up front, not merely parse it. renderMarkdown
  // throws by design on a second h1, an http:// link, a bare relative link or
  // an image with no alt text — and prose is edited constantly while filenames
  // rarely are, so this is the likeliest way to reach a throw at all. Parsing
  // early but rendering late still left dist/ half-rewritten.
  const nav = contentSlugs(contentFiles);
  const parsed = authored.map((file) => {
    const slug = file.replace(/\.md$/, "");
    const { data, body } = parseFrontmatter(io.readFile(`${paths.contentDir}/${file}`), file);
    return { file, slug, html: renderContentPage(data, renderMarkdown(body, file), slug, nav) };
  });

  // The trek pages and the generated /data/ page render up front too, for the
  // same reason. renderTrekPage reaches trek.lat.toFixed(4) unguarded, and
  // `npm run build` never runs validateDataset (validate:data is a separate CI
  // job) — so one hand-edited record used to half-wipe dist/t and exit with a
  // raw TypeError. After this point NOTHING renders: the loop below only writes.
  const trekPages = pages.map((trek) => {
    const slug = slugs.get(trek.id)!;
    return { path: `${paths.outDir}/${slug}/index.html`, html: renderTrekPage(trek, slug) };
  });

  const stats = datasetStats(treks, pages.length);
  const generatedSrc = [
    "---",
    "title: The dataset",
    `description: ${stats.total.toLocaleString("en-IN")} summits — counts, freshness, and how the data stays honest.`,
    "---",
    "",
    dataPageMarkdown(stats, nav, refreshed),
  ].join("\n");
  const generated = parseFrontmatter(generatedSrc, "data.md (generated)");
  const generatedHtml = renderContentPage(
    generated.data,
    renderMarkdown(generated.body, "data.md (generated)"),
    "data",
    nav,
  );

  // ---- Everything above can refuse. Everything below only writes. ----
  io.removeDir(paths.outDir, repoRoot);
  for (const { path, html } of trekPages) io.writeFile(path, html);
  io.log(`[pages] wrote ${pages.length} trek page(s) → ${paths.outDir}`);

  // Content pages (spec 36). Authored markdown, plus a generated /data/ page.
  const written: string[] = [];
  for (const { slug, html } of parsed) {
    io.writeFile(`${paths.distDir}/${slug}/index.html`, html);
    written.push(slug);
  }
  io.writeFile(`${paths.distDir}/data/index.html`, generatedHtml);
  written.push("data");
  // The stamp the post-deploy check compares against (spec 42 §B). Written
  // here because build-pages is the last step of `npm run build`, so a
  // version.json that exists is a build that finished.
  io.writeFile(`${paths.distDir}/version.json`, versionFile(buildSha, buildTime));
  io.log(`[pages] wrote content page(s): ${written.join(", ")}`);
  return { treks: pages.length, content: written };
}

/** The commit this working tree is on, or "unknown" outside git. */
function headSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
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
      // GITHUB_SHA in CI; the local HEAD otherwise, so a hand-built dist is
      // still identifiable rather than claiming to be something it is not.
      process.env.GITHUB_SHA ?? headSha(repoRoot),
      new Date().toISOString(),
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

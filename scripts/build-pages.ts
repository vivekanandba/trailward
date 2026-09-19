/**
 * build-pages — emits one static HTML page per qualifying trek (spec 35 §C)
 * into dist/t/<slug>/index.html. Runs AFTER vite build (postbuild), because
 * it writes into dist alongside the app.
 *
 * The output directory is cleaned first: records get scrubbed between builds
 * (spec 33), and a page for a record that no longer exists would be advertised
 * by the sitemap and 404 for a reader.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { qualifyingTreks, slugMap } from "./lib/pages";
import { renderTrekPage } from "./lib/trekPage";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const outDir = resolve(here, "../dist/t");

async function main(): Promise<void> {
  if (!existsSync(resolve(here, "../dist"))) {
    throw new Error("[pages] dist/ missing — run `npm run build` first");
  }
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const pages = qualifyingTreks(treks);
  const slugs = slugMap(pages);

  // Slug uniqueness is load-bearing: a collision silently overwrites a page.
  if (new Set(slugs.values()).size !== pages.length) {
    throw new Error("[pages] slug collision — refusing to write");
  }

  rmSync(outDir, { recursive: true, force: true });
  for (const trek of pages) {
    const slug = slugs.get(trek.id)!;
    const dir = resolve(outDir, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "index.html"), renderTrekPage(trek, slug), "utf8");
  }
  console.log(`[pages] wrote ${pages.length} trek page(s) → ${outDir}`);
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

/**
 * build-slugs — record a slug for every page that lacks one (spec 35, spec 44
 * register row 17). The registry is a lockfile: this adds new pages and
 * re-attaches a slug to a rescanned record, and never deletes or reassigns a
 * slug. build-pages and build-sitemap only read it.
 *
 *   npm run build:slugs   # after anything that changes treks.json; commit the result
 *
 * With no registry yet it writes the first one from today's order-dependent
 * rules, so every URL already published stays exactly where it is.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { nodeIO, type BuildIO } from "./lib/buildIO";
import type { Trek } from "../src/lib/trek";
import { qualifyingTreks, slugMap } from "./lib/pages";
import {
  SLUGS_FILE,
  formatRegistry,
  readRegistry,
  registryFromSlugMap,
  slugsFromRegistry,
  updateRegistry,
} from "./lib/slugs";

export function runBuildSlugs(
  io: BuildIO,
  repoRoot: string,
): { added: string[]; moved: string[]; total: number } {
  const root = repoRoot.replace(/\/+$/, "");
  const treksFile = `${root}/src/data/treks.json`;
  const slugsFile = `${root}/${SLUGS_FILE}`;
  const treks = JSON.parse(io.readFile(treksFile)) as Trek[];
  const pages = qualifyingTreks(treks);

  if (!io.exists(slugsFile)) {
    const first = registryFromSlugMap(pages, slugMap(pages));
    slugsFromRegistry(pages, first); // the build's own check, first
    io.writeFile(slugsFile, formatRegistry(first));
    const total = Object.keys(first).length;
    io.log(`[slugs] wrote the first registry: ${total} slug(s), today's URLs → ${slugsFile}`);
    return { added: Object.keys(first), moved: [], total };
  }

  const previous = readRegistry(io.readFile(slugsFile));
  const { registry, added, moved, followed } = updateRegistry(pages, previous, treks);
  // What the build will check, checked before the workflow commits it.
  slugsFromRegistry(pages, registry);
  io.writeFile(slugsFile, formatRegistry(registry));
  const total = Object.keys(registry).length;
  io.log(
    `[slugs] ${added.length} added, ${moved.length} re-attached, ` +
      `${followed.length} following a renamed or moved record, ${total} in all`,
  );
  for (const s of moved) io.log(`[slugs] re-attached ${s} → ${registry[s].id}`);
  return { added, moved, total };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runBuildSlugs(nodeIO, resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

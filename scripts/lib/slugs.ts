/**
 * The slug registry (spec 35, spec 44 register row 17): which URL each trek
 * page is published at, recorded once and kept.
 *
 * Before this, slugs were recomputed on every build from the name and the build
 * order, with a `-<id>` suffix on a name collision. So a page's URL changed when
 * another page with the same name appeared earlier in the order, and 438 pages
 * carried a `d12-` id that a terrain rescan regenerates wholesale (spec 27), so
 * their URLs died silently on every rescan.
 *
 * The registry is a lockfile. `npm run build:slugs` adds new pages and
 * re-attaches a slug to a rescanned record; it never deletes or reassigns one.
 * The build only reads it, and refuses a page it has no slug for.
 */
import type { Trek } from "../../src/lib/trek";
import { distanceFrom } from "../../src/lib/distance";
import { foldName, qualifyingTreks, slugFor, slugMap } from "./pages";

export interface SlugEntry {
  id: string;
  lat: number;
  lng: number;
  /** The record's name as `nameKey` gives it; kept current while the record exists. */
  name: string;
}

/** slug → the record published there. Keys are unique by construction. */
export type SlugRegistry = Record<string, SlugEntry>;

// URL-safe. Upper case is allowed: four live URLs end in a Wikidata id
// (`bandarpunch-wd-Q4854459`), and a published URL is never rewritten.
const SLUG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

// A rescan moves a summit by at most a few DEM pixels (spec 27's carryover).
const SAME_PLACE_KM = 0.12;

/**
 * The name a slug is matched on. A name with any non-Latin letter keys as `~`
 * and the name itself (NFC, case and spacing normalised), so "ಕೋಟೆ 2A" and
 * "ಬೆಟ್ಟ 2A" never match, as their folds ("2a") would. Any other name keys as
 * its fold ("Kote Betta" → "kote-betta", "1075" → "1075"); an empty one as "~".
 */
export const nameKey = (t: Trek): string => {
  if (/(?!\p{Script=Latin})\p{L}/u.test(t.name)) {
    return `~${t.name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()}`;
  }
  return foldName(t.name) || "~";
};

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;
const entryFor = (t: Trek): SlugEntry => ({
  id: t.id,
  lat: round5(t.lat),
  lng: round5(t.lng),
  name: nameKey(t),
});

/** Sorted by slug, so the committed file diffs cleanly. */
function sorted(reg: SlugRegistry): SlugRegistry {
  return Object.fromEntries(Object.entries(reg).sort(([a], [b]) => a.localeCompare(b)));
}

/** Where the registry lives, relative to the repo root. */
export const SLUGS_FILE = "scripts/pages/slugs.json";

/** Read the registry, refusing a missing or unreadable one by name. */
export function readRegistry(body: string | undefined): SlugRegistry {
  if (body === undefined) {
    throw new Error(`[slugs] ${SLUGS_FILE} is missing — run npm run build:slugs`);
  }
  let reg: unknown;
  try {
    reg = JSON.parse(body);
  } catch (err) {
    throw new Error(`[slugs] ${SLUGS_FILE} is not valid JSON (${(err as Error).message})`);
  }
  if (typeof reg !== "object" || reg === null || Array.isArray(reg)) {
    throw new Error(`[slugs] ${SLUGS_FILE} is not an object of slug → record`);
  }
  for (const [slug, e] of Object.entries(reg)) {
    const ok = typeof e === "object" && e !== null && typeof (e as SlugEntry).id === "string";
    if (!ok) throw new Error(`[slugs] ${SLUGS_FILE}: "${slug}" has no record id`);
    const { lat, lng } = e as SlugEntry;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`[slugs] ${SLUGS_FILE}: "${slug}" has no position`);
    }
    const name = (e as SlugEntry).name;
    // Folded (as a slug folds it), or `~` and a name with no Latin letters.
    const folded = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
    if (typeof name !== "string" || !(folded || name.startsWith("~"))) {
      throw new Error(`[slugs] ${SLUGS_FILE}: "${slug}" has no recorded name in folded form`);
    }
  }
  return reg as SlugRegistry;
}

/** The first registry: today's URLs, exactly as `slugMap` published them. */
export function registryFromSlugMap(pages: Trek[], slugs: Map<string, string>): SlugRegistry {
  const reg: SlugRegistry = {};
  for (const t of pages) reg[slugs.get(t.id)!] = entryFor(t);
  return sorted(reg);
}

/**
 * Record a slug for every page that lacks one. Pure.
 *
 * - A page whose id is registered keeps its slug.
 * - A page whose id is new, at the same place (≤ 120 m) and under the same
 *   recorded name as a registered record that is gone from the dataset, takes
 *   over that slug, when the match is unambiguous (one candidate each side):
 *   a rescan regenerated the id of the same summit.
 * - Every entry whose record still exists follows its name and position.
 * - A record still in the dataset keeps its slug even while it has no page,
 *   so its URL is waiting when the page comes back.
 * - Otherwise it gets its bare slug if no record ever held it, else
 *   `<slug>-<id>`. A retired slug is never handed to a different peak.
 */
export function updateRegistry(
  pages: Trek[],
  previous: SlugRegistry,
  /** Every record in the dataset, page or not: a record without a page keeps its slug. */
  dataset: Trek[],
): { registry: SlugRegistry; added: string[]; moved: string[]; followed: string[] } {
  const reg: SlugRegistry = { ...previous };
  const slugOf = new Map(Object.entries(reg).map(([slug, e]) => [e.id, slug]));
  const live = new Set([...dataset, ...pages].map((t) => t.id));
  const orphans = new Set(Object.keys(reg).filter((slug) => !live.has(reg[slug].id)));
  const added: string[] = [];
  const moved: string[] = [];

  // Slugs taken in any case: two that differ only in case are one directory
  // on a case-insensitive filesystem, so a new slug avoids both.
  const taken = new Set(Object.keys(reg).map((k) => k.toLowerCase()));

  // Every entry whose record still exists follows it (name and position), so
  // a rename is the name the next rescan matches on, page or not.
  const followed: string[] = [];
  for (const t of [...dataset, ...pages]) {
    const slug = slugOf.get(t.id);
    if (!slug) continue;
    const now = entryFor(t);
    if (JSON.stringify(reg[slug]) === JSON.stringify(now)) continue;
    reg[slug] = now;
    followed.push(slug);
  }

  // A rescan's new page takes an orphan's URL only when the match is
  // unambiguous: the same name within 120 m, and neither side has another
  // such candidate among all new records, pages or not. When two same-named
  // summits are rescanned together no rule can tell which is which, so their
  // URLs retire rather than risk pointing at a different peak.
  const fresh = pages.filter((t) => !slugOf.has(t.id));
  const unslugged = new Map(
    [...dataset, ...pages].filter((t) => !slugOf.has(t.id)).map((t) => [t.id, t]),
  );
  const pairs: { slug: string; t: Trek }[] = [];
  for (const t of unslugged.values()) {
    const key = nameKey(t);
    for (const slug of orphans) {
      const e = reg[slug];
      if (e.name !== key) continue;
      const d = distanceFrom({ id: "", name: "", lat: e.lat, lng: e.lng }, t);
      if (d <= SAME_PLACE_KM) pairs.push({ slug, t });
    }
  }
  // Counted per side: a slug can equal an id, so they need separate tallies.
  const perSlug = new Map<string, number>();
  const perRecord = new Map<string, number>();
  for (const { slug, t } of pairs) {
    perSlug.set(slug, (perSlug.get(slug) ?? 0) + 1);
    perRecord.set(t.id, (perRecord.get(t.id) ?? 0) + 1);
  }
  const isPage = new Set(fresh.map((t) => t.id));
  for (const { slug, t } of pairs) {
    if (perSlug.get(slug) !== 1 || perRecord.get(t.id) !== 1 || !isPage.has(t.id)) continue;
    reg[slug] = entryFor(t);
    orphans.delete(slug);
    slugOf.set(t.id, slug);
    moved.push(slug);
  }

  for (const t of fresh) {
    if (slugOf.has(t.id)) continue;
    const base = slugFor(t);
    // The bare slug, else `<slug>-<id>`, else `<slug>-<id>-<n>`: the first free in any case.
    let slug = base;
    for (let n = 1; taken.has(slug.toLowerCase()); n++) {
      slug = n === 1 ? `${base}-${t.id}` : `${base}-${t.id}-${n}`;
    }
    reg[slug] = entryFor(t);
    taken.add(slug.toLowerCase());
    slugOf.set(t.id, slug);
    added.push(slug);
  }
  return { registry: sorted(reg), added, moved, followed };
}

/**
 * Record id → its registered slug, for every page. Refuses a page with no
 * slug (the registry is stale), a record with two slugs, or an unusable slug.
 */
export function slugsFromRegistry(pages: Trek[], reg: SlugRegistry): Map<string, string> {
  const slugOf = new Map<string, string>();
  const folded = new Map<string, string>();
  for (const [slug, e] of Object.entries(reg)) {
    if (!SLUG.test(slug)) throw new Error(`[slugs] "${slug}" is not a usable slug`);
    // Two slugs that differ only in case are one directory on macOS.
    const twin = folded.get(slug.toLowerCase());
    if (twin) throw new Error(`[slugs] "${twin}" and "${slug}" differ only in case`);
    folded.set(slug.toLowerCase(), slug);
    const other = slugOf.get(e.id);
    if (other) throw new Error(`[slugs] ${e.id} has two slugs: ${other}, ${slug}`);
    slugOf.set(e.id, slug);
  }
  const missing = pages.filter((t) => !slugOf.has(t.id)).map((t) => t.id);
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(", ") + (missing.length > 5 ? ", …" : "");
    throw new Error(
      `[slugs] ${missing.length} page(s) have no registered slug (${shown}) — ` +
        "run npm run build:slugs and commit scripts/pages/slugs.json",
    );
  }
  return new Map(pages.map((t) => [t.id, slugOf.get(t.id)!]));
}

/** The registry the old order-dependent rules would give `treks` — the bootstrap. */
export function registryFor(treks: Trek[]): SlugRegistry {
  const pages = qualifyingTreks(treks);
  return registryFromSlugMap(pages, slugMap(pages));
}

/** One entry per line, sorted: each new or re-attached slug is a one-line diff. */
export function formatRegistry(reg: SlugRegistry): string {
  const lines = Object.entries(sorted(reg)).map(
    ([slug, e]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(e)}`,
  );
  return `{\n${lines.join(",\n")}\n}\n`;
}

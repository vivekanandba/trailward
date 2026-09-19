/**
 * Which treks get a static page, and what they are called (spec 35). Shared by
 * build-sitemap and build-pages so the crawl surface and the generated files
 * can never disagree.
 *
 * Quality over volume: a dump of 120k stub pages is spam, not coverage. A
 * record earns a page by being curated, by carrying real prose or media, or by
 * being the strongest named summit in its 1° cell — the last rule spreads
 * coverage geographically instead of clustering it all on Bengaluru.
 */
import type { Trek } from "../../src/lib/trek";

/** URL-safe, lowercase, diacritics folded. Falls back to the record id. */
export function slugFor(trek: Trek): string {
  const slug = trek.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks: Kumāra → Kumara
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || trek.id;
}

const hasProse = (t: Trek): boolean =>
  Boolean(t.highlights?.trim() || t.historicalNote?.text?.trim() || t.image?.url);

/** A page titled "Unnamed peak (~912 m)" has nothing to rank for. */
const isUnnamed = (t: Trek): boolean => t.name.startsWith("Unnamed");

/** Does this record earn a page on its own merits (rules 1 and 2)? */
export function qualifies(trek: Trek): boolean {
  if (isUnnamed(trek)) return false;
  return trek.tier === "curated" || hasProse(trek);
}

const rank = (t: Trek): number => (t.discoveryScore ?? -1) * 1000 + (t.reliefM ?? 0);

export interface QualifyOptions {
  /** Named summits topped up per 1° cell (rule 3). */
  topPerCell?: number;
}

/**
 * The full page set, deterministic in input order, with slug collisions
 * disambiguated by appending the record id rather than dropping a page.
 */
export function qualifyingTreks(treks: Trek[], opts: QualifyOptions = {}): Trek[] {
  const topPerCell = opts.topPerCell ?? 3;
  const chosen = new Map<string, Trek>();
  for (const t of treks) {
    if (qualifies(t)) chosen.set(t.id, t);
  }

  // Rule 3: per-cell top-up, so coverage is spread across the country.
  const byCell = new Map<string, Trek[]>();
  for (const t of treks) {
    if (isUnnamed(t) || chosen.has(t.id)) continue;
    const key = `${Math.floor(t.lat)}:${Math.floor(t.lng)}`;
    (byCell.get(key) ?? byCell.set(key, []).get(key)!).push(t);
  }
  for (const list of byCell.values()) {
    list.sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
    for (const t of list.slice(0, topPerCell)) chosen.set(t.id, t);
  }

  // Preserve dataset order so successive builds diff cleanly.
  return treks.filter((t) => chosen.has(t.id));
}

/**
 * Record id → the slug its page is written at. PURE: collision resolution
 * lives here rather than in module state, so repeated calls cannot drift and
 * two callers (sitemap, generator) always agree. Collisions ("Nandi Hills"
 * twice) disambiguate by appending the record id — a silently overwritten
 * page is a lost page.
 */
export function slugMap(treks: Trek[]): Map<string, string> {
  const counts = new Map<string, number>();
  const out = new Map<string, string>();
  for (const t of treks) {
    const base = slugFor(t);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    out.set(t.id, n === 0 ? base : `${base}-${t.id}`);
  }
  return out;
}

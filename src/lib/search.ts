/**
 * Palette search over the committed name index (spec 38).
 *
 * No search dependency: the corpus is one array of ~19k named summits and the
 * match is a substring over a pre-folded haystack — instant, predictable, and
 * explainable when a user asks why a result ranked where it did.
 */

export interface IndexEntry {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Alternate names (spec 25) — searchable variants. */
  alt?: string[];
  elevationM?: number;
  /** Hidden-gem score, used only to break ties. */
  score?: number;
}

/** Lowercase, diacritics folded: "Kumāra" and "kumara" must match. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const UNNAMED = /^unnamed /i;

export function searchIndex(index: IndexEntry[], query: string, limit = 8): IndexEntry[] {
  const q = fold(query.trim());
  if (!q) return [];

  const hits: { entry: IndexEntry; prefix: boolean }[] = [];
  for (const entry of index) {
    // An "Unnamed peak (~912 m)" has nothing to search for, and 101k of them
    // would drown every real result.
    if (UNNAMED.test(entry.name)) continue;
    const names = [entry.name, ...(entry.alt ?? [])].map(fold);
    const prefix = names.some((n) => n.startsWith(q));
    if (prefix || names.some((n) => n.includes(q))) hits.push({ entry, prefix });
  }

  hits.sort(
    (a, b) =>
      Number(b.prefix) - Number(a.prefix) ||
      (b.entry.score ?? -1) - (a.entry.score ?? -1) ||
      a.entry.name.localeCompare(b.entry.name),
  );
  return hits.slice(0, limit).map((h) => h.entry);
}

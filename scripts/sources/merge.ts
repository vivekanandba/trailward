/**
 * mergeTrek (spec 02): fold partial Trek fields from several sources into one
 * record. Precedence is positional — earlier parts win — so callers order them
 * highest-priority first (manual/curated > Wikidata/Wikipedia > OSM tag >
 * scraped blog > derived fallbacks like Open-Meteo elevation). `sources` is the
 * union across all parts (deduped, order-preserving) so every contributing
 * source stays traceable.
 */
import type { Trek } from "../../src/lib/trek";

export function mergeTrek(parts: Partial<Trek>[]): Trek {
  const merged: Record<string, unknown> = {};
  const sources: string[] = [];

  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (key === "sources") {
        if (Array.isArray(value)) {
          for (const s of value) if (typeof s === "string") sources.push(s);
        }
        continue;
      }
      if (value === undefined || value === null) continue;
      // First part to define a field wins (positional precedence).
      if (merged[key] === undefined) merged[key] = value;
    }
  }

  merged.sources = Array.from(new Set(sources));
  return merged as unknown as Trek;
}

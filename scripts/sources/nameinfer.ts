/**
 * Name inference for terrain-detected summits (spec 28). A hill's name leaks
 * into the features AROUND it: the reserved forest covering it ("Godumalai
 * Reserved Forest" → Godumalai), the temple on it, the pass or ridge over it.
 * GeoNames carries those features with coordinates, so a tight spatial match
 * plus suffix-stripping recovers the hill's own name — with provenance, never
 * silently.
 *
 * Deliberately conservative: only feature kinds that sit ON the hill qualify
 * (forest / temple / shrine / pass / ridge / slope / cliff). Villages sit at
 * the BASE and share names across a taluk, so they are never used to name a
 * summit. Pure functions; the shell lives in scripts/build-names.ts.
 */

/** GeoNames feature codes that plausibly carry the hill's own name, with the
 *  max distance (km) at which we trust them. */
export const NAMER_CODES: Record<string, number> = {
  RESF: 0.8, // reserved forest — the workhorse (often "X Betta RF")
  FRST: 0.8,
  TMPL: 0.5,
  SHRN: 0.5,
  PASS: 0.8,
  RDGE: 0.8,
  SLP: 0.8,
  CLF: 0.5,
};

// Suffixes that name the FEATURE, not the hill. Stripped iteratively so
// "X Reserved Forest Extension" → "X".
const SUFFIX_RE =
  /\s+(reserved forest|reserve forest|state forest|reserved land|protected forest|village forest|forest|reserve|extension|block|beat|shola|plantation|r\.?\s?f\.?|s\.?\s?f\.?|temple|kovil|gudi|devasthana|shrine|ghat|ghāt|pass)\s*$/i;

// A leftover this generic is not a name.
const GENERIC = new Set([
  "new",
  "old",
  "north",
  "south",
  "east",
  "west",
  "upper",
  "lower",
  "big",
  "small",
  "the",
  // Left over when the WHOLE feature name was generic ("Reserved Forest").
  "reserved",
  "reserve",
  "protected",
  "state",
  "village",
  "forest",
]);

/** Strip feature-type suffixes; undefined when nothing name-like remains. */
export function stripFeatureSuffix(raw: string): string | undefined {
  let name = raw.trim();
  for (let i = 0; i < 4; i++) {
    const next = name.replace(SUFFIX_RE, "").trim();
    if (next === name) break;
    name = next;
  }
  name = name.replace(/[,.]+$/, "").trim();
  if (name.length < 3) return undefined;
  if (GENERIC.has(name.toLowerCase())) return undefined;
  // If stripping consumed everything meaningful ("Reserved Forest Block") the
  // remainder is often a bare cardinal+number ("No 12"); reject digits-only-ish.
  if (!/[a-z]{3}/i.test(name.replace(/[^a-zA-Z]/g, ""))) return undefined;
  return name;
}

export interface NamerFeature {
  name: string;
  code: string;
  lat: number;
  lng: number;
}

export interface InferredName {
  name: string;
  from: string; // the raw feature name, for provenance
  code: string;
  km: number;
}

/**
 * Best name for a summit from nearby namer features: nearest qualifying
 * feature whose stripped name survives. Ties go to the closer feature.
 */
export function inferName(
  summit: { lat: number; lng: number },
  features: NamerFeature[],
  distanceKm: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number,
): InferredName | undefined {
  let best: InferredName | undefined;
  for (const f of features) {
    const maxKm = NAMER_CODES[f.code];
    if (maxKm === undefined) continue;
    const km = distanceKm(summit, f);
    if (km > maxKm) continue;
    const name = stripFeatureSuffix(f.name);
    if (!name) continue;
    if (!best || km < best.km) best = { name, from: f.name, code: f.code, km };
  }
  return best;
}

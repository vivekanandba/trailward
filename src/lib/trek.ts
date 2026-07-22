// Canonical Trek / Origin data model + runtime validation.
// Source of truth: specs/01-data-model.md. The pipeline (scripts/*) and the
// app (src/*) both depend on these types and validators agreeing.

export type Difficulty = "Easy" | "Moderate" | "Hard";
export type TrekType = "Hill" | "Monolith" | "Cave" | "Fort" | "Pilgrimage";
export type Tier = "curated" | "discovery";

export interface TrekImage {
  url: string;
  attribution: string; // required when url is present (license credit)
}

export interface Trek {
  id: string; // stable slug, e.g. "skandagiri"
  name: string;
  lat: number;
  lng: number;
  cityId: string; // origin id this record was curated for, e.g. "bangalore"
  tier: Tier;

  // Distances/measures (optional for discovery treks)
  distanceKm?: number; // road distance from the origin (OSRM)
  driveTimeMin?: number;
  elevationM?: number;
  trailLengthKm?: number;
  trailType?: "one-way" | "round-trip";
  durationHrs?: string; // "2–3"

  // Topography (computed at build time for discovery peaks; spec 11)
  reliefM?: number; // local relief (max − min) over the sampled DEM window
  prominenceProxyM?: number; // summit − lowest neighbour (windowed proxy)
  meanSlopeDeg?: number;
  terrainConfidence?: number; // [0,1]; low for sub-DEM-noise-floor relief
  discoveryScore?: number; // [0,1]; topography × obscurity rank
  estimatedDifficulty?: Difficulty; // terrain-derived; NOT the curated difficulty
  // Nearest OSM walking path to the summit (spec 14): polyline + measures +
  // optional per-vertex elevation (aligned to coords) for the profile chart.
  trail?: { coords: [number, number][]; lengthKm: number; gainM: number; profile?: number[] };

  // Classification & planning (rich = curated)
  difficulty?: Difficulty;
  type?: TrekType[];
  bestSeason?: string; // "Oct–Feb"
  permitRequired?: boolean;
  entryFee?: string; // "₹250 / head" | "Free"
  nightTrek?: boolean;
  highlights?: string;
  nearestTown?: string;
  image?: TrekImage;

  // Provenance
  sources: string[]; // URLs; ≥1 for curated
  verified: boolean;
}

export interface Origin {
  id: string; // "bangalore"
  name: string; // "Bengaluru"
  lat: number;
  lng: number;
}

export const DEFAULT_ORIGIN: Origin = {
  id: "bangalore",
  name: "Bengaluru",
  lat: 12.9716,
  lng: 77.5946,
};

const DIFFICULTIES: Difficulty[] = ["Easy", "Moderate", "Hard"];
const TIERS: Tier[] = ["curated", "discovery"];

type ValidateResult = { ok: true; trek: Trek } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate one record against the Trek contract. On success returns the typed
 * trek; on failure returns a message naming the offending trek id and field so
 * the build can pinpoint bad data.
 */
export function validateTrek(input: unknown): ValidateResult {
  if (!isRecord(input)) return { ok: false, error: "trek must be an object" };

  // id is needed first so every later error can name the record.
  const id = input.id;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, error: "trek <unknown>: field 'id' must be a non-empty string" };
  }
  const fail = (field: string, why: string): ValidateResult => ({
    ok: false,
    error: `trek '${id}': field '${field}' ${why}`,
  });

  if (typeof input.name !== "string" || input.name.length === 0) {
    return fail("name", "must be a non-empty string");
  }
  if (typeof input.lat !== "number" || input.lat < -90 || input.lat > 90) {
    return fail("lat", "must be a number in [-90, 90]");
  }
  if (typeof input.lng !== "number" || input.lng < -180 || input.lng > 180) {
    return fail("lng", "must be a number in [-180, 180]");
  }
  if (typeof input.cityId !== "string" || input.cityId.length === 0) {
    return fail("cityId", "must be a non-empty string");
  }
  if (typeof input.tier !== "string" || !TIERS.includes(input.tier as Tier)) {
    return fail("tier", "must be 'curated' or 'discovery'");
  }
  if (!Array.isArray(input.sources) || !input.sources.every((s) => typeof s === "string")) {
    return fail("sources", "must be an array of strings");
  }
  if (typeof input.verified !== "boolean") {
    return fail("verified", "must be a boolean");
  }

  // Optional numeric ranges.
  if (input.elevationM !== undefined) {
    if (typeof input.elevationM !== "number" || input.elevationM < 0 || input.elevationM > 9000) {
      return fail("elevationM", "must be a number in [0, 9000]");
    }
  }
  if (input.distanceKm !== undefined) {
    if (typeof input.distanceKm !== "number" || input.distanceKm < 0) {
      return fail("distanceKm", "must be a number >= 0");
    }
  }
  if (input.difficulty !== undefined && !DIFFICULTIES.includes(input.difficulty as Difficulty)) {
    return fail("difficulty", "must be one of Easy, Moderate, Hard");
  }

  // Topography fields (spec 11) — optional; range-checked like elevationM.
  const inRange = (field: string, lo: number, hi: number): ValidateResult | null => {
    const v = input[field];
    if (v === undefined) return null;
    if (typeof v !== "number" || Number.isNaN(v) || v < lo || v > hi) {
      return fail(field, `must be a number in [${lo}, ${hi}]`);
    }
    return null;
  };
  const rangeError =
    inRange("reliefM", 0, 9000) ??
    inRange("prominenceProxyM", 0, 9000) ??
    inRange("meanSlopeDeg", 0, 90) ??
    inRange("terrainConfidence", 0, 1) ??
    inRange("discoveryScore", 0, 1);
  if (rangeError) return rangeError;
  if (
    input.estimatedDifficulty !== undefined &&
    !DIFFICULTIES.includes(input.estimatedDifficulty as Difficulty)
  ) {
    return fail("estimatedDifficulty", "must be one of Easy, Moderate, Hard");
  }

  // Trail (spec 14): a coords polyline + non-negative measures.
  if (input.trail !== undefined) {
    const t = input.trail as { coords?: unknown; lengthKm?: unknown; gainM?: unknown };
    const okCoords =
      Array.isArray(t.coords) &&
      t.coords.length > 0 &&
      t.coords.every(
        (c) =>
          Array.isArray(c) &&
          c.length === 2 &&
          typeof c[0] === "number" &&
          typeof c[1] === "number",
      );
    if (!okCoords) return fail("trail.coords", "must be a non-empty array of [lat, lng] pairs");
    if (typeof t.lengthKm !== "number" || t.lengthKm < 0) {
      return fail("trail.lengthKm", "must be a number ≥ 0");
    }
    if (typeof t.gainM !== "number" || t.gainM < 0) {
      return fail("trail.gainM", "must be a number ≥ 0");
    }
    if (
      (t as { profile?: unknown }).profile !== undefined &&
      !(
        Array.isArray((t as { profile?: unknown }).profile) &&
        ((t as { profile: unknown[] }).profile as unknown[]).every((n) => typeof n === "number")
      )
    ) {
      return fail("trail.profile", "must be an array of numbers");
    }
  }

  // Image: a url requires an attribution (licensing requirement).
  if (input.image !== undefined) {
    if (!isRecord(input.image)) return fail("image", "must be an object");
    const { url, attribution } = input.image;
    if (typeof url !== "string" || url.length === 0) {
      return fail("image.url", "must be a non-empty string");
    }
    if (typeof attribution !== "string" || attribution.length === 0) {
      return fail("image.attribution", "is required when image.url is present");
    }
  }

  // Tier-specific provenance rules.
  const tier = input.tier as Tier;
  if (tier === "curated") {
    if (input.sources.length < 1) return fail("sources", "curated treks need >= 1 source");
    if (input.verified !== true) return fail("verified", "curated treks must be verified");
  } else if (input.verified !== false) {
    return fail("verified", "discovery treks must have verified === false");
  }

  return { ok: true, trek: input as unknown as Trek };
}

export function isTrek(input: unknown): input is Trek {
  return validateTrek(input).ok;
}

type DatasetResult = { ok: true; treks: Trek[] } | { ok: false; error: string };

/**
 * Validate a whole dataset: every record must pass validateTrek and all ids
 * must be unique. Used by `validate:data` and the pipeline's final gate.
 */
export function validateDataset(input: unknown): DatasetResult {
  if (!Array.isArray(input)) return { ok: false, error: "dataset must be an array" };

  const treks: Trek[] = [];
  const seen = new Set<string>();
  for (const record of input) {
    const r = validateTrek(record);
    if (!r.ok) return { ok: false, error: r.error };
    if (seen.has(r.trek.id)) {
      return { ok: false, error: `duplicate trek id '${r.trek.id}'` };
    }
    seen.add(r.trek.id);
    treks.push(r.trek);
  }
  return { ok: true, treks };
}

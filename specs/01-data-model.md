# 01 — Data Model

## Purpose

Define the canonical `Trek` and `Origin` shapes and the validation rules that every record must
satisfy, so the pipeline, the app, and the tests all agree on one contract.

## User stories

- As a **developer**, I want one typed definition of a trek so the map, filters, and detail card
  never disagree about fields.
- As the **maintainer**, I want bad records (missing coordinates, impossible elevation) rejected
  at build time so the live site never ships broken data.

## Acceptance criteria

- **Given** a record from the pipeline, **when** it is validated, **then** it is accepted only if
  all required fields are present and within range; otherwise the build fails with a message
  naming the trek id and the offending field.
- **Given** a `curated` trek, **when** validated, **then** it must have ≥1 `sources` entry and
  `verified === true`.
- **Given** a `discovery` trek, **when** validated, **then** `verified === false` and rich fields
  (fees, permits, photo, highlights) may be absent.
- **Given** any trek, **when** validated, **then** `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`,
  `elevationM ∈ [0, 9000]`, `distanceKm ≥ 0`, `difficulty ∈ {Easy, Moderate, Hard}`.

## Interfaces & data contracts

```ts
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

// Runtime validator used by the pipeline and `validate:data`.
export function validateTrek(
  input: unknown,
): { ok: true; trek: Trek } | { ok: false; error: string };
export function isTrek(input: unknown): input is Trek;
```

## Edge cases & error states

- Unknown extra fields are ignored (forward compatible), not errors.
- Duplicate `id`s across the dataset are a validation failure.
- A `curated` trek missing a rich field is allowed (e.g. fee unknown) **except** `sources`.
- `image.url` present but `attribution` empty → validation failure (licensing requirement).

## Test cases (TDD checklist)

- Accepts a complete curated fixture; accepts a minimal discovery fixture.
- Rejects: out-of-range lat/lng, elevation > 9000, missing `id`/`name`, bad `difficulty`.
- Rejects curated trek with empty `sources` or `verified !== true`.
- Rejects an `image` with url but no attribution.
- Rejects a dataset with duplicate ids.
- `isTrek` narrows types correctly for valid/invalid inputs.

## Out of scope

- How fields are sourced/filled (→ 02). How they're displayed (→ 06).

## Open questions

- Do we want a `lastVerifiedAt` date per curated trek to flag stale data? (Lean yes — cheap, aids
  long-term maintenance. Confirm before adding.)

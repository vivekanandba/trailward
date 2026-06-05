// Remembers the user's chosen origin across reloads (spec 03). localStorage is
// wrapped so private-mode failures degrade to the default origin, never throw.
import { DEFAULT_ORIGIN, type Origin } from "./trek";

export const ORIGIN_STORAGE_KEY = "trailward.origin";

function isValidOrigin(v: unknown): v is Origin {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.name === "string" &&
    o.name.length > 0 &&
    typeof o.lat === "number" &&
    o.lat >= -90 &&
    o.lat <= 90 &&
    typeof o.lng === "number" &&
    o.lng >= -180 &&
    o.lng <= 180
  );
}

/** The persisted origin, or DEFAULT_ORIGIN when missing/corrupt/unavailable. */
export function loadOrigin(): Origin {
  try {
    const raw = localStorage.getItem(ORIGIN_STORAGE_KEY);
    if (!raw) return DEFAULT_ORIGIN;
    const parsed: unknown = JSON.parse(raw);
    return isValidOrigin(parsed) ? parsed : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** Persist the chosen origin; silently no-ops if storage is unavailable. */
export function saveOrigin(o: Origin): void {
  try {
    localStorage.setItem(ORIGIN_STORAGE_KEY, JSON.stringify(o));
  } catch {
    // private mode / quota — fall back to in-memory (default each load)
  }
}

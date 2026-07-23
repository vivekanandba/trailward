// Basemap choice persistence (spec 13): the street "map" (theme-based CARTO) or
// a topographic "terrain" layer (OpenTopoMap). Mirrors lib/theme.ts. Terrain is
// the default — this is a trekking app, so the landscape should read first.
export type Basemap = "map" | "terrain";

const KEY = "trailward:basemap";

/** Saved basemap, or "terrain" when none/invalid/storage blocked. */
export function loadBasemap(): Basemap {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "map" || v === "terrain") return v;
  } catch {
    /* storage blocked — fall through to default */
  }
  return "terrain";
}

export function saveBasemap(b: Basemap): void {
  try {
    localStorage.setItem(KEY, b);
  } catch {
    /* ignore */
  }
}

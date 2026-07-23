// Single source of truth for difficulty → colour (spec 08). Markers, badges,
// and the detail card all read from here so they can never drift apart.
import type { Difficulty } from "./trek";

// Colourblind-friendly trio: distinct in both hue and lightness. Each is dark
// enough that white text on it meets WCAG AA (≥4.5:1), since badges/markers
// render white-on-colour (Moderate darkened from #ed6c02, which was ~2.8:1).
export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  Easy: "#2e7d32", // green  (~4.6:1 on white)
  Moderate: "#b45309", // amber (~5.0:1 on white)
  Hard: "#c62828", // red    (~5.3:1 on white)
};

// Discovery / unknown-difficulty treks (community, unverified).
export const DISCOVERY_COLOR = "#64748b"; // slate grey

// Brighter, higher-chroma variants for MAP MARKERS only. The badge colours above
// are darkened for white-text WCAG contrast, which makes amber/red sink into the
// warm terrain basemap; pins carry no text, so they use vivid fills (over a white
// halo + shadow) to stay legible. Legend + pins read from here.
export const MAP_DIFFICULTY_COLORS: Record<Difficulty, string> = {
  Easy: "#22c55e", // vivid green — distinct from the dark cluster green + olive terrain
  Moderate: "#f97316", // vivid orange — pops off the brown hills
  Hard: "#ef4444", // vivid red
};

export function difficultyColor(difficulty?: Difficulty): string {
  return difficulty ? DIFFICULTY_COLORS[difficulty] : DISCOVERY_COLOR;
}

/** Brighter colour for map markers/legend (see MAP_DIFFICULTY_COLORS). */
export function mapDifficultyColor(difficulty?: Difficulty): string {
  return difficulty ? MAP_DIFFICULTY_COLORS[difficulty] : DISCOVERY_COLOR;
}

export function difficultyLabel(difficulty?: Difficulty): string {
  return difficulty ?? "Unverified";
}

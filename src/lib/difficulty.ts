// Single source of truth for difficulty → colour (spec 08). Markers, badges,
// and the detail card all read from here so they can never drift apart.
import type { Difficulty } from "./trek";

// Colourblind-friendly trio: distinct in both hue and lightness.
export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  Easy: "#2e7d32", // green
  Moderate: "#ed6c02", // orange
  Hard: "#c62828", // red
};

// Discovery / unknown-difficulty treks (community, unverified).
export const DISCOVERY_COLOR = "#64748b"; // slate grey

export function difficultyColor(difficulty?: Difficulty): string {
  return difficulty ? DIFFICULTY_COLORS[difficulty] : DISCOVERY_COLOR;
}

export function difficultyLabel(difficulty?: Difficulty): string {
  return difficulty ?? "Unverified";
}

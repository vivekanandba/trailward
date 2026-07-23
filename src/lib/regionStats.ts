// Region overview aggregate (spec 15). Pure — summarises the peaks currently in
// view for a compact stats card. Difficulty counts fall back to the terrain
// estimate so discovery peaks are included.
import type { Difficulty, Trek } from "./trek";

export interface RegionStats {
  count: number;
  spread: Record<Difficulty, number>;
  highestM?: number;
  maxReliefM?: number;
  topGem?: { name: string; score: number };
}

export function regionStats(treks: Trek[]): RegionStats {
  const spread: Record<Difficulty, number> = { Easy: 0, Moderate: 0, Hard: 0 };
  let highestM: number | undefined;
  let maxReliefM: number | undefined;
  let topGem: { name: string; score: number } | undefined;

  for (const t of treks) {
    const diff = t.difficulty ?? t.estimatedDifficulty;
    if (diff) spread[diff] += 1;
    if (t.elevationM !== undefined) highestM = Math.max(highestM ?? -Infinity, t.elevationM);
    if (t.reliefM !== undefined) maxReliefM = Math.max(maxReliefM ?? -Infinity, t.reliefM);
    if (t.discoveryScore !== undefined && (!topGem || t.discoveryScore > topGem.score)) {
      topGem = { name: t.name, score: t.discoveryScore };
    }
  }

  return { count: treks.length, spread, highestM, maxReliefM, topGem };
}

/**
 * Sentences built from what we hold (spec 44 R6–R8, rule D1). Each clause
 * comes from a field or arithmetic on fields; when an input is missing its
 * clause is dropped, never filled. No "about", no plausible default, and an
 * "Unnamed peak" never leads a clause.
 */
import { compassPoint, toIstClock, type SunTimes } from "./sun";
import { bestSeasonFrom, driestMonths, dryMonths, type MonthlyRain } from "./climate";
import type { RegionStats } from "./regionStats";

/** "Sunrise 06:05 and sunset 18:43 today (IST); the sun comes up in the east-northeast." */
export function sunSentence(t: SunTimes): string {
  if (t.kind === "always-up") return "The sun does not set here today.";
  if (t.kind === "always-down") return "The sun does not rise here today.";
  return (
    `Sunrise ${toIstClock(t.rise)} and sunset ${toIstClock(t.set)} today (IST); ` +
    `the sun comes up in the ${compassPoint(t.riseAzimuth)}.`
  );
}

/**
 * Whether this month falls in the cell's drier stretch, by rainfall. Says
 * nothing when the cell has no clear dry season or the data is malformed:
 * `driestMonths` returns [] for both, and neither is a fact about the season.
 */
export function seasonSentence(
  monthly: MonthlyRain | undefined,
  month0: number,
): string | undefined {
  if (!monthly) return undefined;
  const dry = driestMonths(monthly);
  const stretch = bestSeasonFrom(monthly)?.replace(/ \(driest\)$/, "");
  if (dry.length === 0 || dry.length >= 11 || !stretch) return undefined;
  if (dry.includes(month0)) return `Now is the drier stretch here (${stretch}), going by rainfall.`;
  // Dry, but outside the longest dry run: say so, not "wetter" (rule D1).
  if (dryMonths(monthly).includes(month0)) {
    return `Now is one of the drier months here; the longest dry stretch is ${stretch}, going by rainfall.`;
  }
  return `Now is the wetter part of the year here; the drier stretch is ${stretch}, going by rainfall.`;
}

const isNamed = (name: string): boolean => !name.startsWith("Unnamed");

/** Join clauses as "a, b and c". */
function list(items: string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * "601 peaks around Bengaluru, most of them easy; the highest stands at
 * 1712 m, and the top hidden gem is Kumbārachi Kallu."
 */
export function regionSentence(stats: RegionStats, place: string): string {
  const { Easy, Moderate, Hard } = stats.spread;
  const graded = Easy + Moderate + Hard;
  let head = `${stats.count} peak${stats.count === 1 ? "" : "s"} around ${place}`;
  if (graded > 0) {
    const levels = [
      ["easy", Easy],
      ["moderate", Moderate],
      ["hard", Hard],
    ] as const;
    const major = levels.find(([, n]) => n / graded > 0.5);
    head += major
      ? `, most of them ${major[0]}`
      : `, a mix of ${list(levels.filter(([, n]) => n > 0).map(([l]) => l))}`;
  }
  const tail: string[] = [];
  if (stats.highestM !== undefined) tail.push(`the highest stands at ${stats.highestM} m`);
  if (stats.topGem && isNamed(stats.topGem.name)) {
    tail.push(`the top hidden gem is ${stats.topGem.name}`);
  }
  return tail.length ? `${head}; ${tail.join(", and ")}.` : `${head}.`;
}

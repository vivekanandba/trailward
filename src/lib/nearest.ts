/**
 * Nearest names (spec 44 R10, R12): what was probably meant, when nothing
 * matched exactly. Similarity is 1 − edit distance / longer length, on text
 * folded the way search folds it. A floor keeps guesses out, and `bestMatch`
 * refuses a tie: two equally close answers mean we do not know which was meant.
 */
import { fold } from "./search";

/**
 * Edit distance, or `limit + 1` as soon as every entry of a row exceeds
 * `limit`: the distance can only grow from there, so the rest is not needed.
 */
let rowA = new Int32Array(64);
let rowB = new Int32Array(64);

function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  // Two rows reused across every call: allocating rows dominated the cost.
  if (rowA.length <= b.length) {
    rowA = new Int32Array(b.length + 1);
    rowB = new Int32Array(b.length + 1);
  }
  let prev = rowA;
  let cur = rowB;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1);
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, sub);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// Folding is the costly half of a comparison and the names repeat on every
// keystroke, so each is folded once per session.
const folded = new Map<string, string>();
function foldOnce(s: string): string {
  let f = folded.get(s);
  if (f === undefined) {
    f = fold(s);
    folded.set(s, f);
  }
  return f;
}

function similarityFolded(x: string, y: string, floor = 0): number {
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  const limit = Math.floor((1 - floor) * longest);
  return 1 - editDistance(x, y, limit) / longest;
}

export function similarity(a: string, b: string): number {
  return similarityFolded(fold(a), fold(b));
}

export interface NearestOptions {
  /** How many to offer at most. */
  max?: number;
  /** The least similarity worth offering. */
  floor?: number;
}

const FLOOR = 0.75;

/**
 * A similarity of at least `floor` allows an edit distance of at most
 * (1 − floor) × the longer length, so a length gap bigger than that rules a
 * name out before folding or comparing it: over the 19k-name index this took
 * a no-match keystroke from 140 ms to a few. (+1 slack: raw and folded
 * lengths can differ by a combining mark.)
 */
function couldReach(q: number, n: number, floor: number): boolean {
  return Math.abs(q - n) <= (1 - floor) * Math.max(q, n) + 1;
}

export function nearestNames(query: string, names: string[], opts: NearestOptions = {}): string[] {
  const { max = 3, floor = FLOOR } = opts;
  const q = fold(query);
  return names
    .filter((name) => couldReach(q.length, name.length, floor))
    .map((name) => ({ name, s: similarityFolded(q, foldOnce(name), floor) }))
    .filter((c) => c.s >= floor)
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((c) => c.name);
}

/** The single clearly-best candidate, or undefined on a tie or below the floor. */
export function bestMatch(query: string, candidates: string[], floor = FLOOR): string | undefined {
  const scored = candidates.map((c) => ({ c, s: similarity(query, c) })).sort((a, b) => b.s - a.s);
  const [first, second] = scored;
  if (!first || first.s < floor) return undefined;
  if (second && second.s === first.s) return undefined;
  return first.c;
}

/**
 * "Been there" (spec 44 R16, register row 19): the peaks a person has climbed,
 * kept in this browser's localStorage and nowhere else. No account, no server,
 * nothing shared. Every read and write is guarded, because storage can be
 * missing, blocked, full or corrupt, and none of that may break the app.
 */
export const CLIMBED_KEY = "trailward.climbed";

/** Trek id → the day it was first ticked (YYYY-MM-DD). */
export type Climbed = Map<string, string>;

export function loadClimbed(): Climbed {
  try {
    const raw = localStorage.getItem(CLIMBED_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return new Map();
  }
}

/**
 * Tick or untick a peak. Ticking again keeps the first day. Returns whether the
 * change was stored, so the UI can say so rather than pretend.
 */
export function setClimbed(id: string, climbed: boolean, today?: string): boolean {
  const all = loadClimbed();
  if (climbed) {
    if (!all.has(id)) all.set(id, today ?? new Date().toISOString().slice(0, 10));
  } else {
    all.delete(id);
  }
  try {
    localStorage.setItem(CLIMBED_KEY, JSON.stringify(Object.fromEntries(all)));
    return true;
  } catch {
    return false;
  }
}

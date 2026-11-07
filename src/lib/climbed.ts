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
  try {
    // Read what is stored as it is, not as loadClimbed reads it: a value this
    // code cannot read (corrupt, or a future format) is refused, never
    // overwritten with this one tick and the rest silently lost.
    const raw = localStorage.getItem(CLIMBED_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : {};
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return false;
    const all = { ...(stored as Record<string, unknown>) };
    if (climbed) {
      if (!(id in all)) all[id] = today ?? localDay(new Date());
    } else {
      delete all[id];
    }
    localStorage.setItem(CLIMBED_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** The person's own calendar day, YYYY-MM-DD: a 02:00 tick in India is that day, not UTC's. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

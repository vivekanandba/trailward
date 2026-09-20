/**
 * The constitution gate — pure part (spec 39).
 *
 * Machine-wide rules live in a separate REMOTE repository. This repo must
 * never treat a local clone as the authority: a working copy can sit on a
 * feature branch with uncommitted edits, which is exactly the state that
 * prompted this gate. What we can check, and do:
 *
 *  - nothing in this repo points at a local clone path;
 *  - every rule id cited here actually exists;
 *  - no rule text has been pasted in (cite, never restate — copies drift);
 *  - the pinned copy still matches the remote.
 */

export interface ConstitutionLock {
  /** https URL of the constitution repository. */
  repo: string;
  /** Branch or tag the pin follows. */
  ref: string;
  /** Full 40-char commit the hash was taken at. */
  commit: string;
  /** sha256 of CONSTITUTION.md at that commit. */
  sha256: string;
}

export function parseLock(raw: string): ConstitutionLock {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("constitution.lock is not valid JSON");
  }
  const d = data as Record<string, unknown>;
  const str = (k: keyof ConstitutionLock): string =>
    typeof d[k] === "string" ? (d[k] as string) : "";

  if (!/^https:\/\/\S+$/.test(str("repo"))) {
    throw new Error("constitution.lock: 'repo' must be an https URL — not an ssh or local path");
  }
  if (!str("ref")) throw new Error("constitution.lock: 'ref' must name a branch or tag");
  if (!/^[0-9a-f]{40}$/.test(str("commit"))) {
    throw new Error("constitution.lock: 'commit' must be a full 40-character sha");
  }
  if (!/^[0-9a-f]{64}$/.test(str("sha256"))) {
    throw new Error("constitution.lock: 'sha256' must be a 64-character hex digest");
  }
  return { repo: str("repo"), ref: str("ref"), commit: str("commit"), sha256: str("sha256") };
}

/**
 * Paths that reach into a local clone of the constitution. Prose must name the
 * remote URL instead — the whole point of the pin is that local is not the
 * authority.
 */
export function findLocalPaths(text: string): string[] {
  const patterns = [
    /~\/[\w./-]*constitution[\w./-]*/g,
    /\/home\/[\w.-]+\/[\w./-]*constitution[\w./-]*/g,
    /\/Users\/[\w.-]+\/[\w./-]*constitution[\w./-]*/g,
  ];
  const hits = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) hits.add(m[0]);
  }
  return [...hits];
}

const RULE_ID = /\bCON-[A-Z]{2,6}-\d{3}\b/g;

/** Rule ids defined by the constitution text (its own headings). */
export function knownRuleIds(constitution: string): Set<string> {
  return new Set([...constitution.matchAll(RULE_ID)].map((m) => m[0]));
}

/** Cited ids that the constitution does not define, each reported once. */
export function findUnknownRuleIds(text: string, known: Set<string>): string[] {
  const unknown = new Set<string>();
  for (const m of text.matchAll(RULE_ID)) {
    if (!known.has(m[0])) unknown.add(m[0]);
  }
  return [...unknown];
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Runs of `minWords` consecutive words shared with the constitution — a paste.
 * Short quotations are fine and deliberately not flagged.
 */
export function findCopiedText(text: string, constitution: string, minWords = 12): string[] {
  const source = words(constitution);
  if (source.length < minWords) return [];
  const grams = new Set<string>();
  for (let i = 0; i + minWords <= source.length; i++) {
    grams.add(source.slice(i, i + minWords).join(" "));
  }
  const mine = words(text);
  const hits = new Set<string>();
  for (let i = 0; i + minWords <= mine.length; i++) {
    const gram = mine.slice(i, i + minWords).join(" ");
    if (grams.has(gram)) hits.add(gram);
  }
  return [...hits];
}

/**
 * `constitution-ok: <reason>` exempts a file — for the gate's own tests, and
 * the spec that documents it, which must contain the very strings the gate
 * looks for. The reason is mandatory: a gate with no legitimate exit gets
 * routed around, and a silent exemption is indistinguishable from a bypass.
 */
export function isExempt(text: string): boolean {
  return /constitution-ok:\s*\S/.test(text);
}

/**
 * Decode the base64 body GitHub's contents API returns.
 *
 * It arrives wrapped at 60 characters. The newlines must be stripped and the
 * whole thing decoded ONCE: decoding each line to a string separately corrupts
 * any UTF-8 sequence that straddles a chunk boundary, and the constitution is
 * full of em-dashes and middots. That bug made this gate report "the rules
 * changed" against a remote that was byte-identical to the pin.
 */
export function decodeGhContent(base64: string): string {
  return Buffer.from(base64.replace(/\s+/g, ""), "base64").toString("utf8");
}

export type RemoteStatus = "match" | "mismatch" | "unreachable";

/**
 * Exit code policy. A mismatch always fails: the rules moved and the pin must
 * be bumped deliberately. An unreachable remote fails ONLY where access is
 * configured — otherwise developers would be blocked by infrastructure that
 * has not landed yet. It never reports success it has not earned; the caller
 * prints what was and was not verified.
 */
export function exitCodeFor(
  status: RemoteStatus,
  env: { ci: boolean; accessConfigured: boolean },
): 0 | 1 {
  if (status === "mismatch") return 1;
  if (status === "unreachable") return env.accessConfigured ? 1 : 0;
  return 0;
}

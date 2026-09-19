/**
 * External link integrity — the pure part (spec 37).
 *
 * The dataset carries thousands of source URLs (Wikipedia, GeoNames, OSM,
 * archive.org). They rot off-box, after merge, when somebody else's site
 * changes; no other check in this repo can see that.
 *
 * Two rules learned from the sibling portfolio project:
 *  - Bot walls (403/429/999) say nothing about whether a link works for a
 *    person. Reported as failures they make the check cry wolf, and a checker
 *    people ignore protects nothing — so they are UNVERIFIED.
 *  - Compare without the fragment: fetch never sends it, so every #anchor
 *    would otherwise look like a redirect.
 */

export type Outcome = "ok" | "moved" | "unverified" | "failed";

export interface Probe {
  url: string;
  finalUrl: string;
  status: number;
  error?: string;
}

export interface Result {
  url: string;
  outcome: Outcome;
  status?: number;
  finalUrl?: string;
}

/** Bot-walled statuses — visible, but never a build-breaker. */
const BOT_WALLED = new Set([403, 429, 999]);

const norm = (u: string): string => u.replace(/#.*$/, "").replace(/\/+$/, "");

export function sameTarget(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

export function classifyLink(probe: Probe): Outcome {
  if (probe.error || probe.status === 0) return "failed";
  if (BOT_WALLED.has(probe.status)) return "unverified";
  if (probe.status >= 400) return "failed";
  if (probe.status >= 200 && probe.status < 300) {
    return probe.finalUrl && !sameTarget(probe.url, probe.finalUrl) ? "moved" : "ok";
  }
  return "failed";
}

export interface Report {
  counts: Record<Outcome, number>;
  text: string;
  /** Always 0: advisory. A third party's outage must not block a merge. */
  exitCode: 0;
}

export function summarise(results: Result[]): Report {
  const counts: Record<Outcome, number> = { ok: 0, moved: 0, unverified: 0, failed: 0 };
  for (const r of results) counts[r.outcome]++;

  const lines: string[] = [
    `${counts.ok} ok · ${counts.moved} moved · ${counts.unverified} unverified · ${counts.failed} failed`,
  ];
  for (const r of results.filter((x) => x.outcome === "failed")) {
    lines.push(`FAILED  ${r.url}${r.status ? ` (${r.status})` : ""}`);
  }
  for (const r of results.filter((x) => x.outcome === "moved")) {
    lines.push(`MOVED   ${r.url} → ${r.finalUrl}`);
  }
  for (const r of results.filter((x) => x.outcome === "unverified")) {
    lines.push(`UNVERIFIED ${r.url}${r.status ? ` (${r.status})` : ""} — bot wall, not checked`);
  }
  return { counts, text: lines.join("\n"), exitCode: 0 };
}

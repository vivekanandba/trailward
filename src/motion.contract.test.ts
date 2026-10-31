import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Spec 44 D2 (a still version of every movement), D3 (motion over 300 ms only
// when it carries information) and D4 (focus always visible), held by source
// checks so a new component cannot quietly break them.
const SRC = resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "data" ? [] : files(p);
    return /\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const sources = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));
const css = readFileSync(join(SRC, "index.css"), "utf8");

/**
 * Motion longer than 300 ms is allowed only when it carries information
 * (spec 44 D3). Each entry names the file, the duration and the requirement
 * that justifies it.
 */
const LONG_MOTION_ALLOWED: { path: string; ms: number; rule: string }[] = [
  {
    path: "index.css",
    ms: 600,
    rule: "R16: a short celebration of something the person did (ticking a peak)",
  },
];

describe("motion (spec 44 D2, D3)", () => {
  it("asks the motion helper instead of reading the media query directly", () => {
    const direct = sources.filter(
      (s) =>
        s.path !== "lib/motion.ts" &&
        // A call, not a mention: a comment may name the media query.
        /matchMedia\W[^\n]*prefers-reduced-motion/.test(s.text),
    );
    expect(direct.map((s) => s.path)).toEqual([]);
  });

  it("stills every CSS animation and transition under reduced motion", () => {
    const block =
      css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/);
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important/);
  });

  it("keeps every duration at 300 ms or under unless it is allowed by name", () => {
    const long: string[] = [];
    for (const s of sources) {
      const found = [
        ...[...s.text.matchAll(/(\d+(?:\.\d+)?)ms\b/g)].map((m) => Number(m[1])),
        ...[...s.text.matchAll(/\bduration-(\d+)\b/g)].map((m) => Number(m[1])),
      ];
      for (const ms of found) {
        if (ms <= 300) continue;
        if (LONG_MOTION_ALLOWED.some((a) => a.path === s.path && a.ms === ms)) continue;
        long.push(`${s.path}: ${ms}ms`);
      }
    }
    expect(long).toEqual([]);
  });
});

describe("focus (spec 44 D4)", () => {
  it("draws a ring for keyboard focus on anything that does not style its own", () => {
    const base = css.match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(base).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid/);
  });

  it("never removes an outline without putting a visible ring in its place", () => {
    const bare: string[] = [];
    for (const s of sources.filter((x) => x.path.endsWith(".tsx"))) {
      for (const [cls] of s.text.matchAll(/(["'`])[^"'`\n]*outline-none[^"'`\n]*\1/g)) {
        if (!/\bfocus(-visible)?:ring-\d/.test(cls)) bare.push(`${s.path}: ${cls.slice(0, 60)}…`);
      }
    }
    expect(bare).toEqual([]);
  });
});

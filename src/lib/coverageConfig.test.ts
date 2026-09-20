// @vitest-environment node
// jsdom's TextEncoder does not satisfy an invariant esbuild asserts on load,
// and importing the vite config pulls esbuild in. This file needs no DOM.
import { describe, it, expect } from "vitest";
import { coverageConfigDefaults } from "vitest/config";
import config from "../../vite.config";

/**
 * A coverage number that counts the test files is not a coverage number.
 *
 * Vitest REPLACES `coverage.exclude` rather than merging it, so writing the
 * array bare silently drops the default exclusion for `*.test.ts` files. The test
 * files are ~100% covered by construction, which inflated every figure in this
 * repo by about ten points — global read 84.97% when it was 74.48%. It was
 * caught in review, not by any gate, so this is the gate (CON-PROC-003).
 *
 * The floors themselves cannot catch it: setting one to 100 only proves the
 * glob matches something, not that it matches the right things.
 */
describe("coverage configuration (spec 40)", () => {
  const exclude = (config as { test?: { coverage?: { exclude?: string[] } } }).test?.coverage
    ?.exclude;

  it("keeps vitest's default exclusions instead of replacing them", () => {
    expect(exclude).toBeDefined();
    for (const pattern of coverageConfigDefaults.exclude) {
      expect(exclude, `default exclusion dropped: ${pattern}`).toContain(pattern);
    }
  });

  it("excludes test files, so they are never counted as covered source", () => {
    expect(exclude!.some((p) => p.includes("test"))).toBe(true);
  });

  it("carries only the two deliberate project exclusions beyond the defaults", () => {
    // Each needs a stated reason (CON-COV-002); this pins the list so a third
    // one cannot be slipped in to flatter the number without a test changing.
    const extra = exclude!.filter((p) => !coverageConfigDefaults.exclude.includes(p));
    expect(extra.sort()).toEqual(["src/components/TrekMap.tsx", "src/main.tsx"]);
  });
});

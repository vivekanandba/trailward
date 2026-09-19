import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The spec-discipline gate's patterns, read from the script itself so this
 * test cannot drift from what CI actually runs (spec 37). An unenforced gate
 * reads as protection while providing none — worse than no gate.
 */
const script = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../check-spec-discipline.sh"),
  "utf8",
);

function pattern(name: string): RegExp {
  const m = new RegExp(`^${name}='([^']+)'`, "m").exec(script);
  if (!m) throw new Error(`${name} not found in check-spec-discipline.sh`);
  return new RegExp(m[1]);
}

const requires = (file: string): boolean =>
  pattern("SPEC_REQUIRING").test(file) && !pattern("EXEMPT").test(file);

describe("spec-discipline pattern (spec 37)", () => {
  it("requires a spec for the data contract and EVERY pipeline script", () => {
    for (const file of [
      "src/lib/trek.ts",
      "scripts/build-detect.ts",
      // The narrow first draft missed all of these — the reason this test exists.
      "scripts/build-summits-extra.ts",
      "scripts/discover-precompute.ts",
      "scripts/scrub-implausible.ts",
      "scripts/check-enrichment-drift.ts",
      "scripts/chunk-data.ts",
      "scripts/build-sitemap.ts",
      "scripts/build-pages.ts",
    ]) {
      expect(requires(file), file).toBe(true);
    }
  });

  it("exempts helpers, seeds, and the gate itself", () => {
    for (const file of [
      "scripts/lib/pages.ts",
      "scripts/lib/markdown.ts",
      "scripts/lib/linkcheck.ts",
      "scripts/check-spec-discipline.sh",
    ]) {
      expect(requires(file), file).toBe(false);
    }
  });

  it("does not demand a spec for ordinary app code", () => {
    for (const file of ["src/App.tsx", "src/components/TrekMap.tsx", "src/lib/seo.ts"]) {
      expect(requires(file), file).toBe(false);
    }
  });
});

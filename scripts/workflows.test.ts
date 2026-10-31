import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Spec 42 §E. ubuntu-latest moved to 26.04 on its own schedule, Playwright
// 1.60 cannot install its browser dependencies there, and every e2e job and
// the deploy's e2e gate failed with no change in this repo. Screenshot
// baselines are also only valid on the image that rendered them.
const dir = resolve(__dirname, "../.github/workflows");

/** Each job of a workflow file as [name, its text]. Jobs sit at two spaces under `jobs:`. */
function jobs(file: string): [string, string][] {
  const text = readFileSync(resolve(dir, file), "utf8");
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  return body
    .split(/^(?= {2}[a-z][a-z0-9-]*:\n)/m)
    .filter((b) => /^ {2}[a-z]/.test(b))
    .map((b) => [b.slice(2, b.indexOf(":")), b]);
}

const playwrightJobs = readdirSync(dir)
  .filter((f) => f.endsWith(".yml"))
  .flatMap((f) => jobs(f).map(([name, b]) => ({ id: `${f}:${name}`, block: b })))
  .filter((j) => /playwright (install|test)|npm run e2e/.test(j.block));

const runsOn = (block: string): string | undefined => block.match(/^ {4}runs-on: (.+)$/m)?.[1];

describe("Playwright jobs run on a pinned image (spec 42 §E)", () => {
  it("finds the jobs it is about", () => {
    // ci e2e + e2e-static, deploy's two e2e gates, the baseline generator.
    expect(playwrightJobs.length).toBeGreaterThanOrEqual(5);
  });

  it("never on ubuntu-latest, which moves under them", () => {
    const moving = playwrightJobs.filter((j) => runsOn(j.block)?.includes("latest"));
    expect(moving.map((j) => j.id)).toEqual([]);
  });

  it("all on the image that renders the screenshot baselines", () => {
    const images = new Set(playwrightJobs.map((j) => runsOn(j.block)));
    expect([...images]).toHaveLength(1);
  });
});

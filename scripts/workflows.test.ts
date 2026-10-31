import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

// Spec 42 §E. ubuntu-latest moved to 26.04 on its own schedule, Playwright
// 1.60 cannot install its browser dependencies there, and every e2e job and
// the deploy's e2e gate failed with no change in this repo. Screenshot
// baselines are also only valid on the image that rendered them.
const dir = resolve(__dirname, "../.github/workflows");

interface Job {
  "runs-on"?: unknown;
  steps?: { id?: string; run?: string; uses?: string; with?: Record<string, unknown> }[];
}

const jobs = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) => {
    const wf = load(readFileSync(resolve(dir, f), "utf8")) as { jobs?: Record<string, Job> };
    return Object.entries(wf.jobs ?? {}).map(([name, job]) => ({
      file: f,
      id: `${f}:${name}`,
      job,
    }));
  });

// Any step that installs or runs Playwright, however it is spelt: a command
// or an action.
const usesPlaywright = (job: Job): boolean =>
  (job.steps ?? []).some((s) => /playwright|npm run e2e/.test(`${s.run ?? ""} ${s.uses ?? ""}`));

const playwrightJobs = jobs.filter((j) => usesPlaywright(j.job));

describe("Playwright jobs run on one pinned image (spec 42 §E)", () => {
  it("are exactly the five it is about, so none drops out unnoticed", () => {
    expect(playwrightJobs.map((j) => j.id).sort()).toEqual([
      "ci.yml:e2e",
      "ci.yml:e2e-static",
      "deploy.yml:e2e",
      "deploy.yml:e2e-static",
      "visual-baselines.yml:baselines",
    ]);
  });

  it("each names a single fixed image, never a latest label", () => {
    for (const { id, job } of playwrightJobs) {
      const runsOn = job["runs-on"];
      expect(typeof runsOn, `${id}: runs-on must be one label`).toBe("string");
      expect(runsOn as string, id).not.toMatch(/latest/);
    }
  });

  it("all on the same image, the one that renders the screenshot baselines", () => {
    expect(new Set(playwrightJobs.map((j) => j.job["runs-on"])).size).toBe(1);
  });

  it("the baseline generator rewrites every screenshot, not only failing ones", () => {
    // Plain --update-snapshots means "changed": drift inside the tolerance was
    // never refreshed, and the run reported "already match" over a stale image.
    const gen = playwrightJobs.find((j) => j.id === "visual-baselines.yml:baselines")!;
    const runs = (gen.job.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/--update-snapshots=all\b/);
  });

  it("the browser cache is keyed on the runner image, read in a step", () => {
    // ${{ env.ImageOS }} is empty in an expression (env holds only
    // workflow-set variables), which made every key "playwright--<hash>".
    for (const { id, job } of playwrightJobs) {
      const cache = (job.steps ?? []).find((s) => s.uses?.startsWith("actions/cache"));
      if (!cache) continue;
      const image = (job.steps ?? []).find((s) => s.id === "image");
      expect(image?.run, id).toMatch(/\$\{?ImageOS\}?-\$\{?ImageVersion\}?/);
      expect(String(cache.with?.key), id).toContain("${{ steps.image.outputs.id }}");
      expect(String(cache.with?.key), id).not.toContain("env.ImageOS");
    }
  });

  it("the shipped build and the checks run on the image the e2e gates use", () => {
    // Pinning only the Playwright jobs left the deploy's build on whatever
    // ubuntu-latest became that week.
    const image = playwrightJobs[0].job["runs-on"];
    const shipping = jobs.filter((j) => j.file === "ci.yml" || j.file === "deploy.yml");
    expect(shipping.filter((j) => j.job["runs-on"] !== image).map((j) => j.id)).toEqual([]);
  });

  it("the local update command rewrites every screenshot too", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["e2e:update"]).toMatch(/--update-snapshots=all\b/);
  });
});

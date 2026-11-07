import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

// Spec 42 §E. ubuntu-latest moved to 26.04 on its own schedule, Playwright
// 1.60 cannot install its browser dependencies there, and every e2e job and
// the deploy's e2e gate failed with no change in this repo. Screenshot
// baselines are also only valid on the image that rendered them.
const dir = resolve(__dirname, "../.github/workflows");

interface Job {
  "runs-on"?: unknown;
  steps?: {
    id?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
  }[];
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

const SETUP = "./.github/actions/playwright-setup";

// Any step that installs or runs Playwright, however it is spelt: a command,
// an action, or the shared setup action.
const usesPlaywright = (job: Job): boolean =>
  (job.steps ?? []).some((s) => /playwright|npm run e2e/.test(`${s.run ?? ""} ${s.uses ?? ""}`));

const playwrightJobs = jobs.filter((j) => usesPlaywright(j.job));

const action = load(
  readFileSync(resolve(__dirname, "../.github/actions/playwright-setup/action.yml"), "utf8"),
) as { runs: { steps: NonNullable<Job["steps"]> } };

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

  it("each names one literal, versioned Ubuntu image", () => {
    // A substring ban on "latest" let `self-hosted`, a matrix or a repo
    // variable through; only a literal version pins the rendering.
    for (const { id, job } of playwrightJobs) {
      expect(job["runs-on"], id).toMatch(/^ubuntu-\d\d\.\d\d$/);
    }
  });

  it("all on the same image, the one that renders the screenshot baselines", () => {
    expect(new Set(playwrightJobs.map((j) => j.job["runs-on"])).size).toBe(1);
  });

  it("the shipped build and the checks run on the image the e2e gates use", () => {
    // Pinning only the Playwright jobs left the deploy's build on whatever
    // ubuntu-latest became that week.
    const image = playwrightJobs[0].job["runs-on"];
    const shipping = jobs.filter((j) => j.file === "ci.yml" || j.file === "deploy.yml");
    expect(shipping.filter((j) => j.job["runs-on"] !== image).map((j) => j.id)).toEqual([]);
  });

  it("each sets up browsers through the one shared action, after its checkout", () => {
    for (const { id, job } of playwrightJobs) {
      const steps = (job.steps ?? []).map((s) => s.uses ?? s.run ?? "");
      expect(
        steps.filter((s) => s === SETUP),
        id,
      ).toHaveLength(1);
      // A local action needs the repo checked out first; no checkout at all
      // must fail too (findIndex would return -1 and pass a bare comparison).
      const checkout = steps.findIndex((s) => s.startsWith("actions/checkout"));
      expect(checkout, `${id} has no checkout`).toBeGreaterThanOrEqual(0);
      expect(steps.indexOf(SETUP), id).toBeGreaterThan(checkout);

      expect(
        steps.some((s) => /playwright install/.test(s)),
        `${id} installs outside the action`,
      ).toBe(false);
    }
  });

  it("the shared action keys its cache on the OS release, read in a step before the cache", () => {
    // ${{ env.ImageOS }} is empty in an expression (env holds only
    // workflow-set variables), which made every key "playwright--<hash>".
    const steps = action.runs.steps;
    const image = steps.findIndex((s) => s.id === "image");
    const caches = steps
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s.uses?.startsWith("actions/cache"));
    expect(caches.length).toBeGreaterThan(0);
    // /etc/os-release works on any Linux runner; ImageOS exists only on
    // GitHub's images, and ImageVersion moves weekly (it discarded the cache).
    expect(steps[image]?.run).toMatch(/\/etc\/os-release/);
    expect(steps[image]?.run).not.toMatch(/ImageVersion/);
    for (const [cache, i] of caches) {
      expect(i).toBeGreaterThan(image);
      expect(String(cache.with?.key)).toContain("${{ steps.image.outputs.os }}");
      expect(String(cache.with?.key)).not.toContain("env.");
    }
  });

  it("no CI run but the baseline generator updates snapshots", () => {
    // Otherwise every toHaveScreenshot rewrites its baseline and passes, and
    // the visual gate checks nothing.
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const updates = /(^|\s)(-u|--update-snapshots)(\s|=|$)/;
    for (const j of playwrightJobs.filter((j) => j.id !== "visual-baselines.yml:baselines")) {
      for (const st of j.job.steps ?? []) {
        const run = st.run ?? "";
        expect(run, j.id).not.toMatch(updates);
        for (const m of run.matchAll(/npm run ([\w:-]+)/g)) {
          expect(pkg.scripts[m[1]] ?? "", `${j.id} → ${m[1]}`).not.toMatch(updates);
        }
      }
    }
  });

  it("the baseline generator rewrites every screenshot, in the suite's two passes", () => {
    // Plain --update-snapshots means "changed": drift inside the tolerance was
    // never refreshed. And one pass with the static project starves the dev
    // server (playwright.config.ts), as npm run e2e avoids.
    const gen = playwrightJobs.find((j) => j.id === "visual-baselines.yml:baselines")!;
    const runs = (gen.job.steps ?? [])
      .map((s) => s.run ?? "")
      .filter((r) => /playwright test/.test(r));
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r).toMatch(/--update-snapshots=all\b/);
    expect(runs.filter((r) => /--project=static/.test(r))).toHaveLength(1);
    expect(runs.find((r) => /--project=static/.test(r))).not.toMatch(/--project=(chromium|mobile)/);
  });

  it("every job that builds the static pages gives them the data's date (spec 44 R5)", () => {
    // #89 updated CI and deploy but not the baseline workflow, whose static
    // pass then lost "Data as of" and failed for every branch.
    const builds = jobs.filter(({ job }) =>
      (job.steps ?? []).some((st) =>
        /npm run (build|e2e:static)(?![\w:-])|--project=static|--project static/.test(st.run ?? ""),
      ),
    );
    expect(builds.map((j) => j.id).sort()).toEqual(
      [
        "ci.yml:e2e-static",
        "deploy.yml:build",
        "deploy.yml:e2e-static",
        "visual-baselines.yml:baselines",
      ].sort(),
    );
    for (const { id, job } of builds) {
      const steps = job.steps ?? [];
      const checkout = steps.find((st) => st.uses?.startsWith("actions/checkout"));
      expect(checkout?.with?.["fetch-depth"], `${id} fetch-depth`).toBe(0);
      expect(
        steps.some((st) => /TRAILWARD_DATA_DATE=.*git log -1 --format=%cs/.test(st.run ?? "")),
        `${id} passes TRAILWARD_DATA_DATE`,
      ).toBe(true);
    }
  });

  it("a scheduled data job lands through push-data.sh, one writer at a time (spec 10)", () => {
    // The 2026-11-07 refresh built and checked its data for 2.5 h, then lost
    // it to a rejected push; a bare rebase would have landed it unchecked on
    // a main that had since gained the slug registry.
    for (const f of ["refresh-data.yml", "apply-suggestions.yml"]) {
      const text = readFileSync(resolve(dir, f), "utf8");
      const wf = load(text) as { concurrency?: { group?: string } };
      expect(wf.concurrency?.group, `${f} concurrency`).toBe("data-writer");
      const runs = jobs
        .filter((j) => j.id.startsWith(`${f}:`))
        .flatMap((j) => j.job.steps ?? [])
        .map((st) => st.run ?? "");
      expect(
        runs.some((r) => /scripts\/push-data\.sh/.test(r)),
        f,
      ).toBe(true);
      expect(
        runs.filter((r) => /git push/.test(r)),
        `${f} pushes only via push-data.sh`,
      ).toEqual([]);
      // A token push starts no workflow: what landed is deployed by dispatch.
      const steps = jobs
        .filter((j) => j.id.startsWith(`${f}:`))
        .flatMap((j) => j.job.steps ?? []) as { run?: string; if?: string }[];
      const publish = steps.find((st) => /gh workflow run deploy\.yml/.test(st.run ?? ""));
      expect(publish, `${f} dispatches the deploy`).toBeDefined();
      expect(publish?.if, f).toMatch(/steps\.land\.outputs\.pushed == 'true'/);
      const perms = (wf as { permissions?: Record<string, string> }).permissions ?? {};
      expect(perms.actions, `${f} may dispatch the deploy`).toBe("write");
    }
  });

  it("CI runs the named e2e scripts, never `npm run e2e -- <flags>`", () => {
    // npm appends extra arguments only to the LAST command of a compound
    // script: `npm run e2e -- --project=static` ran the app suite, then static
    // mixed with the app projects in one pass.
    const passing = jobs.filter(({ job }) =>
      (job.steps ?? []).some((st) => /npm run e2e\s+--/.test(st.run ?? "")),
    );
    expect(passing.map((j) => j.id)).toEqual([]);
  });
});

describe("the suite cannot hide a flake (spec 42 §E, CON-VER-008)", () => {
  // Comments stripped, so a commented-out setting does not count.
  const config = readFileSync(resolve(__dirname, "../playwright.config.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("fails a run in CI when a test passed only on retry", () => {
    expect(config).toMatch(/failOnFlakyTests:\s*!!process\.env\.CI/);
  });

  it("bounds an assertion's wait well above a cold mount under load", () => {
    // The expect block's own timeout, not one nested in toHaveScreenshot.
    const block = config.match(/expect:\s*\{\s*timeout:\s*([\d_]+)/)?.[1];
    expect(Number(block?.replace(/_/g, ""))).toBeGreaterThanOrEqual(15_000);
  });

  it("no explicit bound anywhere in e2e is tighter than that default", () => {
    // Every `timeout: N` in the e2e tree: assertions, expect.poll, waitFor.
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = resolve(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    const tight = walk(resolve(__dirname, "../e2e")).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\btimeout:\s*([\d_]+)/g)]
        .map((m) => Number(m[1].replace(/_/g, "")))
        .filter((ms) => ms < 15_000)
        .map((ms) => `${f}: ${ms}`),
    );
    expect(tight).toEqual([]);
  });
});

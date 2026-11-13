import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// scripts/data-date.sh, which every job that builds the static pages runs
// through .github/actions/data-date (issue #94, spec 44 R5): the date the data
// last changed, or a red step, never a blank that the pages print as nothing.
const script = resolve(__dirname, "data-date.sh");
let dir: string;

// A repo of our own: strip git's variables so a hook's GIT_DIR cannot point
// these commands at the real checkout (CON-PROC-016).
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
) as Record<string, string>;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();

function commit(repo: string, file: string, date: string) {
  mkdirSync(join(repo, "src/data"), { recursive: true });
  writeFileSync(join(repo, file), `${date}\n`);
  git(repo, "add", ".");
  execFileSync("git", ["commit", "-q", "-m", date], {
    cwd: repo,
    env: { ...env, GIT_COMMITTER_DATE: `${date}T12:00:00Z`, GIT_AUTHOR_DATE: `${date}T12:00:00Z` },
  });
}

function run(cwd: string) {
  const out = join(dir, "github-env");
  writeFileSync(out, "");
  const r = spawnSync("bash", [script], {
    cwd,
    env: { ...env, GITHUB_ENV: out },
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, written: readFileSync(out, "utf8") };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "data-date-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@t");
  commit(repo, "src/data/treks.json", "2026-11-01");
  commit(repo, "README.md", "2026-11-09"); // later, but not the data
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("data-date.sh", () => {
  it("exports the date treks.json last changed, not the latest commit's", () => {
    const r = run(join(dir, "repo"));
    expect(r.status, r.out).toBe(0);
    expect(r.written).toBe("TRAILWARD_DATA_DATE=2026-11-01\n");
  });

  it("refuses a shallow clone, whose last commit would be the deploy's date", () => {
    const shallow = join(dir, "shallow");
    git(dir, "clone", "-q", "--depth", "1", `file://${join(dir, "repo")}`, shallow);
    const r = run(shallow);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/shallow/);
    expect(r.written).toBe("");
  });

  it("refuses when treks.json has no history to date it by (a wrong path, say)", () => {
    const other = join(dir, "other");
    mkdirSync(other);
    git(other, "init", "-q");
    git(other, "config", "user.name", "t");
    git(other, "config", "user.email", "t@t");
    commit(other, "README.md", "2026-11-09");
    const r = run(other);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/could not read when src\/data\/treks.json last changed/);
    expect(r.written).toBe("");
  });
});

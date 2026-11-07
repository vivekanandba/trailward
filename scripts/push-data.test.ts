import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// scripts/push-data.sh against a real throwaway remote (spec 10): a data run
// lands on top of whatever main became while it ran, re-derived and
// re-checked there, or not at all.
const script = resolve(__dirname, "push-data.sh");
let remote: string;
let runner: string;
let other: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

function clone(to: string): string {
  execFileSync("git", ["clone", "-q", remote, to], { stdio: "pipe" });
  git(to, "config", "user.name", "t");
  git(to, "config", "user.email", "t@t");
  return to;
}

function push(recheck: string): { status: number | null; out: string } {
  const r = spawnSync(
    "bash",
    [script, "chore(data): refresh", recheck, "data.json", "--", "derived.txt"],
    {
      cwd: runner,
      env: {
        ...process.env,
        GITHUB_REF_NAME: "main",
        GITHUB_OUTPUT: join(runner, "..", "gh-output"),
      },
      encoding: "utf8",
    },
  );
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "push-data-"));
  remote = join(dir, "remote.git");
  // `init -b` is newer than this VM's git 2.25; symbolic-ref works on any.
  execFileSync("git", ["init", "-q", "--bare", remote]);
  execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: remote });
  const seed = clone(join(dir, "seed"));
  writeFileSync(join(seed, "data.json"), "old\n");
  writeFileSync(join(seed, "code.txt"), "v1\n");
  writeFileSync(join(seed, "derived.txt"), "from old\n");
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "push", "-q", "origin", "HEAD:main");
  runner = clone(join(dir, "runner"));
  other = clone(join(dir, "other"));
});

const mainHas = (file: string) => {
  git(other, "pull", "-q");
  return readFileSync(join(other, file), "utf8");
};

describe("push-data.sh", () => {
  it("pushes straight away when the branch did not move, without rechecking", () => {
    writeFileSync(join(runner, "data.json"), "new\n");
    const r = push("touch rechecked");
    expect(r.status, r.out).toBe(0);
    expect(mainHas("data.json")).toBe("new\n");
    expect(readFileSync(join(runner, "..", "gh-output"), "utf8")).toBe("pushed=true\n");
    expect(existsSync(join(runner, "rechecked"))).toBe(false);
  });

  it("re-derives on top of a branch that moved, then pushes both changes", () => {
    writeFileSync(join(runner, "data.json"), "new\n");
    writeFileSync(join(other, "code.txt"), "v2\n"); // merged while the run ran
    git(other, "commit", "-qam", "code");
    git(other, "push", "-q");
    // The recheck sees the new code: it stamps the data with it.
    const r = push('printf "new+%s" "$(cat code.txt)" > data.json');
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/moved since this run began/);
    expect(mainHas("code.txt")).toBe("v2\n");
    expect(mainHas("data.json")).toBe("new+v2");
  });

  it("refuses, pushing nothing, when the recheck fails on the new branch", () => {
    writeFileSync(join(runner, "data.json"), "new\n");
    writeFileSync(join(other, "code.txt"), "v2\n");
    git(other, "commit", "-qam", "code");
    git(other, "push", "-q");
    const r = push("exit 3");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(runner, "..", "gh-output"))).toBe(false); // nothing to publish
    expect(mainHas("data.json")).toBe("old\n");
  });

  it("rebuilds a derived file main regenerated meanwhile, instead of refusing", () => {
    // Derived files are main's; only this run's source data is carried over.
    writeFileSync(join(runner, "data.json"), "new\n");
    writeFileSync(join(runner, "derived.txt"), "from new (old code)\n");
    writeFileSync(join(other, "derived.txt"), "regenerated on main\n");
    git(other, "commit", "-qam", "regenerate");
    git(other, "push", "-q");
    const r = push('printf "from %s" "$(cat data.json)" > derived.txt');
    expect(r.status, r.out).toBe(0);
    expect(mainHas("data.json")).toBe("new\n");
    expect(mainHas("derived.txt")).toBe("from new");
  });

  it("says a refused push is refused, and does not retry it as a race", () => {
    writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/sh\necho protected >&2\nexit 1\n");
    chmodSync(join(remote, "hooks", "pre-receive"), 0o755);
    writeFileSync(join(runner, "data.json"), "new\n");
    const r = push("true");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/push refused:.*protected/s);
    expect(r.out).not.toMatch(/raced/);
  });

  it("refuses when the branch changed the same data", () => {
    writeFileSync(join(runner, "data.json"), "mine\n");
    writeFileSync(join(other, "data.json"), "theirs\n");
    git(other, "commit", "-qam", "data");
    git(other, "push", "-q");
    const r = push("true");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/conflicts/);
    expect(mainHas("data.json")).toBe("theirs\n");
  });

  it("does nothing when there is no data change", () => {
    const r = push("touch rechecked");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/no data changes/);
  });
});

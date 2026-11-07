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
        PUSH_DATA_RETRY_DELAY: "0",
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

  it("lands a run that changed only derived files on a moved branch", () => {
    // An empty source patch is nothing to carry, not a conflict.
    writeFileSync(join(runner, "derived.txt"), "rebuilt\n");
    writeFileSync(join(other, "code.txt"), "v2\n");
    git(other, "commit", "-qam", "code");
    git(other, "push", "-q");
    const r = push('printf "rebuilt on %s" "$(cat code.txt)" > derived.txt');
    expect(r.status, r.out).toBe(0);
    expect(mainHas("derived.txt")).toBe("rebuilt on v2");
  });

  it("counts a push that reached the server but reported failure as landed", () => {
    // A git that pushes, then says it failed (a connection dropped after the
    // server accepted): the retry must see its own commit and say so.
    const bin = join(runner, "..", "bin");
    execFileSync("mkdir", ["-p", bin]);
    const realGit = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(bin, "git"),
      `#!/bin/bash\nif [ "$1" = push ] && [ ! -e "${bin}/once" ]; then touch "${bin}/once"; "${realGit}" "$@"; echo "connection reset" >&2; exit 1; fi\nexec "${realGit}" "$@"\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    writeFileSync(join(runner, "data.json"), "new\n");
    const r = spawnSync("bash", [script, "m", "true", "data.json", "--", "derived.txt"], {
      cwd: runner,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REF_NAME: "main",
        PUSH_DATA_RETRY_DELAY: "0",
        GITHUB_OUTPUT: join(runner, "..", "gh-output"),
      },
      encoding: "utf8",
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/already landed/);
    expect(readFileSync(join(runner, "..", "gh-output"), "utf8")).toBe("pushed=true\n");
  });

  // A git whose pushes report failure: the first `fail` of them without
  // reaching the server, then one that reaches it and still says it failed.
  function flakyGit(fail: number, thenOther?: string): string {
    const bin = join(runner, "..", `bin-${fail}`);
    execFileSync("mkdir", ["-p", bin]);
    const realGit = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const other = thenOther
      ? `(cd "${thenOther}" && "${realGit}" pull -q && "${realGit}" commit -q --allow-empty -m on-top && "${realGit}" push -q) || exit 9;`
      : "";
    writeFileSync(
      join(bin, "git"),
      `#!/bin/bash
if [ "$1" = push ]; then
  n=$(cat "${bin}/n" 2>/dev/null || echo 0); echo $((n+1)) > "${bin}/n"
  if [ "$n" -lt ${fail} ]; then echo "connection reset" >&2; exit 1; fi
  if [ "$n" = ${fail} ]; then "${realGit}" "$@"; ${other} echo "connection reset" >&2; exit 1; fi
fi
exec "${realGit}" "$@"
`,
    );
    chmodSync(join(bin, "git"), 0o755);
    return bin;
  }

  function pushWith(bin: string): { status: number | null; out: string } {
    const r = spawnSync("bash", [script, "m", "true", "data.json", "--", "derived.txt"], {
      cwd: runner,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REF_NAME: "main",
        PUSH_DATA_RETRY_DELAY: "0",
        GITHUB_OUTPUT: join(runner, "..", "gh-output"),
      },
      encoding: "utf8",
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it("counts a push that landed on the last attempt but reported failure as landed", () => {
    writeFileSync(join(runner, "data.json"), "new\n");
    const r = pushWith(flakyGit(2));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/landed despite the error/);
    expect(readFileSync(join(runner, "..", "gh-output"), "utf8")).toBe("pushed=true\n");
  });

  it("counts a landed push as landed even after someone pushed on top of it", () => {
    writeFileSync(join(runner, "data.json"), "new\n");
    const r = pushWith(flakyGit(0, other));
    expect(r.status, r.out).toBe(0);
    expect(git(other, "log", "-1", "--format=%s")).toBe("on-top"); // someone really did
    expect(r.out).toMatch(/already landed/);
    expect(readFileSync(join(runner, "..", "gh-output"), "utf8")).toBe("pushed=true\n");
  });

  it("says a refused push is refused, and does not retry it as a race", () => {
    writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/sh\necho protected >&2\nexit 1\n");
    chmodSync(join(remote, "hooks", "pre-receive"), 0o755);
    writeFileSync(join(runner, "data.json"), "new\n");
    const r = push("true");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/push refused:.*protected/s);
    expect(r.out).not.toMatch(/will retry/);
  });

  it("refuses when the branch changed the same data", () => {
    writeFileSync(join(runner, "data.json"), "mine\n");
    writeFileSync(join(other, "data.json"), "theirs\n");
    git(other, "commit", "-qam", "data");
    git(other, "push", "-q");
    const r = push("true");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/does not apply on main; refusing/);
    expect(mainHas("data.json")).toBe("theirs\n");
  });

  it("does nothing when there is no data change", () => {
    const r = push("touch rechecked");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/no data changes/);
  });
});

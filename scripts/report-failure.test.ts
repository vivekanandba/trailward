import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// report-failure.sh files a failed scheduled run as one open issue (spec 10).
// It runs against a fake `gh` that answers `issue list` from a fixture and
// records every other call, so the decision is tested without the network.
const script = resolve(__dirname, "report-failure.sh");
let dir: string;
let calls: string;

function fakeGh(openIssues: { number: number; title: string; pull_request?: object }[]): void {
  writeFileSync(join(dir, "issues.json"), JSON.stringify(openIssues));
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
if [ "$1" = "api" ]; then
  printf '%s\\n' "$*" > "${dir}/list-args"
  # Apply the --jq filter the script passes, as gh would.
  for ((i=1; i<=$#; i++)); do if [ "\${!i}" = "--jq" ]; then j=$((i+1)); q="\${!j}"; fi; done
  jq -r "$q" "${dir}/issues.json"
  exit 0
fi
printf '%s\\n' "$*" >> "${dir}/calls"
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
}

function run(title: string, result = "failure"): string {
  execFileSync("bash", [script, title, result], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_REPO: "o/r",
      RUN_URL: "https://example/run/1",
    },
  });
  try {
    return readFileSync(calls, "utf8");
  } catch {
    return "";
  }
}

// The fake gh applies the script's --jq filter with jq, as gh itself would.
beforeAll(() => {
  try {
    execFileSync("jq", ["--version"]);
  } catch {
    throw new Error("report-failure.test.ts needs `jq` on PATH to stand in for gh's --jq");
  }
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "report-failure-"));
  calls = join(dir, "calls");
});

describe("report-failure.sh", () => {
  it("opens an issue when none with that exact title is open", () => {
    fakeGh([]);
    expect(run("Weekly data refresh is failing")).toMatch(
      /^issue create --title Weekly data refresh is failing --body .*https:\/\/example\/run\/1/,
    );
  });

  it("comments on the open issue with that exact title instead of opening another", () => {
    fakeGh([{ number: 7, title: "Weekly data refresh is failing" }]);
    expect(run("Weekly data refresh is failing")).toMatch(/^issue comment 7 --body /);
  });

  it("does not comment on an issue whose title merely contains the words", () => {
    fakeGh([{ number: 3, title: "Weekly data refresh is failing for Mysore pins" }]);
    expect(run("Weekly data refresh is failing")).toMatch(/^issue create /);
  });

  it("closes the open issue when a later run succeeds", () => {
    fakeGh([{ number: 7, title: "Weekly data refresh is failing" }]);
    expect(run("Weekly data refresh is failing", "success")).toMatch(/^issue close 7 --comment /);
  });

  it("does nothing on success when no issue is open", () => {
    fakeGh([]);
    expect(run("Weekly data refresh is failing", "success")).toBe("");
  });

  it("files a cancelled run: a timeout or a missing runner is a failure nobody saw", () => {
    fakeGh([]);
    const out = run("Weekly data refresh is failing", "cancelled");
    expect(out).toMatch(/^issue create /);
    // ...said as what it was, not as a failure (CON-VER-005).
    expect(out).toContain("This scheduled run was cancelled");
    expect(out).not.toContain("run failed");
  });

  it("does nothing for a skipped run, which is not a verdict", () => {
    fakeGh([{ number: 7, title: "Weekly data refresh is failing" }]);
    expect(run("Weekly data refresh is failing", "skipped")).toBe("");
  });

  it("reads every open issue through the REST list, not the lagging search index", () => {
    // A just-filed issue is missing from search for a while, so a quick
    // re-run would open a duplicate; --paginate means no count can hide it.
    fakeGh([]);
    run("Weekly data refresh is failing");
    const args = readFileSync(join(dir, "list-args"), "utf8");
    expect(args).toMatch(/^api --paginate repos\/o\/r\/issues\?state=open/);
    expect(args).not.toContain("--search");
  });

  it("never mistakes a pull request with that title for the issue", () => {
    fakeGh([{ number: 9, title: "Weekly data refresh is failing", pull_request: {} }]);
    expect(run("Weekly data refresh is failing")).toMatch(/^issue create /);
  });

  it("closes every open duplicate when a later run succeeds", () => {
    fakeGh([
      { number: 7, title: "Weekly data refresh is failing" },
      { number: 8, title: "Weekly data refresh is failing" },
    ]);
    const out = run("Weekly data refresh is failing", "success");
    expect(out).toMatch(/^issue close 7 --comment .*\nissue close 8 --comment /s);
  });

  it("says only that the run failed: what it changed before failing is not known here", () => {
    // apply-suggestions may close suggestion issues before a later step fails.
    fakeGh([]);
    const out = run("Weekly data refresh is failing");
    expect(out).toContain("This scheduled run failed:");
    expect(out).not.toMatch(/changed nothing/);
  });

  it("refuses a missing result instead of reporting it as a failure", () => {
    // A renamed job makes needs.<job>.result empty: "could not tell" is not
    // "failed" (CON-VER-005), and the reporter job must go red to say so.
    fakeGh([{ number: 7, title: "Weekly data refresh is failing" }]);
    expect(() => run("Weekly data refresh is failing", "")).toThrow();
    expect(() => readFileSync(calls, "utf8")).toThrow(); // nothing was posted
  });

  it("only main's runs report: a dispatched run on a branch is not production", () => {
    const dir = resolve(__dirname, "../.github/workflows");
    for (const f of [
      "refresh-data.yml",
      "apply-suggestions.yml",
      "weekly-links.yml",
      "weekly-live-apis.yml",
    ]) {
      const text = readFileSync(join(dir, f), "utf8");
      const job = text.slice(text.indexOf("  report-failure:"));
      expect(job, f).toMatch(/if: always\(\) && github\.ref == 'refs\/heads\/main'/);
    }
  });

  it("refuses to run without a title", () => {
    fakeGh([]);
    expect(() => run("")).toThrow();
  });
});

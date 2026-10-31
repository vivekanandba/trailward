import { describe, it, expect, beforeEach } from "vitest";
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

function fakeGh(openIssues: { number: number; title: string }[]): void {
  writeFileSync(join(dir, "issues.json"), JSON.stringify(openIssues));
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
if [ "$1 $2" = "issue list" ]; then
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

function run(title: string): string {
  execFileSync("bash", [script, title], {
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

  it("refuses to run without a title", () => {
    fakeGh([]);
    expect(() => run("")).toThrow();
  });
});

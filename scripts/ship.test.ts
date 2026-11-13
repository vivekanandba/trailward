import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// scripts/ship.sh's review-thread reads (issue #83). PRs #79 and #80 reached
// 101+ threads and the first-100 query reported "0 unresolved" with one open.
//
// fixtures/review-threads-pr79.jsonl is the real API's answer for PR #79,
// captured 2026-11-13 with `gh api graphql --paginate` (two pages, 108
// threads; comment bodies cut to 60 characters). The fake gh below serves
// those pages and runs the script's own --jq filter over each with jq, the
// way gh does; without --paginate it serves only the first page, as gh does.
const script = resolve(__dirname, "ship.sh");
const captured = readFileSync(resolve(__dirname, "fixtures/review-threads-pr79.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

let dir: string;
let log: string;

const FAKE_GH = `#!/bin/bash
log="$FAKE_LOG"
case "$1 $2" in
  "repo view") echo vivekanandba/trailward; exit 0 ;;
  "pr checks") exit 0 ;;
  "pr merge") echo merge >> "$log"; exit 0 ;;
esac
[ "$1 $2" = "api graphql" ] || { echo "fake gh: unexpected $*" >&2; exit 2; }
shift 2
paginate=0 query="" filter="" id=""
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) paginate=1 ;;
    -f) query="\${2#query=}"; shift ;;
    -F) case "$2" in id=*) id="\${2#id=}" ;; esac; shift ;;
    --jq) filter="$2"; shift ;;
  esac
  shift
done
if [[ "$query" == *resolveReviewThread* ]]; then echo "resolve $id" >> "$log"; echo true; exit 0; fi
[ -n "\${FAKE_FAIL:-}" ] && { echo "HTTP 502" >&2; exit 1; }
n=0
while IFS= read -r page; do
  n=$((n+1))
  [ "$paginate" = 0 ] && [ "$n" -gt 1 ] && break
  if [ -n "$filter" ]; then jq -r "$filter" <<< "$page" || exit 1; else echo "$page"; fi
done < "$FAKE_PAGES"
`;

type Page = (typeof captured)[number];
const threads = (p: Page) => p.data.repository.pullRequest.reviewThreads;

function serve(pages: Page[]) {
  writeFileSync(join(dir, "pages.jsonl"), pages.map((p) => JSON.stringify(p)).join("\n") + "\n");
}

// The captured pages with one thread left open: the last one, past the 100th.
function lastThreadOpen(): { pages: Page[]; id: string } {
  const pages: Page[] = structuredClone(captured);
  const nodes = threads(pages[pages.length - 1]).nodes;
  nodes[nodes.length - 1].isResolved = false;
  return { pages, id: nodes[nodes.length - 1].id };
}

function ship(...args: string[]) {
  const r = spawnSync("bash", [script, ...args], {
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      FAKE_LOG: log,
      FAKE_PAGES: join(dir, "pages.jsonl"),
    },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

const logged = () => (existsSync(log) ? readFileSync(log, "utf8") : "");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ship-"));
  log = join(dir, "log");
  spawnSync("mkdir", ["-p", join(dir, "bin")]);
  writeFileSync(join(dir, "bin", "gh"), FAKE_GH);
  chmodSync(join(dir, "bin", "gh"), 0o755);
});

describe("ship.sh review threads", () => {
  it("the captured PR really has more threads than one page holds", () => {
    expect(captured).toHaveLength(2);
    expect(threads(captured[0]).totalCount).toBe(108);
    expect(threads(captured[0]).pageInfo.hasNextPage).toBe(true);
  });

  it("counts an open thread past the 100th", () => {
    serve(lastThreadOpen().pages);
    const r = ship("unresolved", "79");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("1");
  });

  it("refuses to merge with an open thread past the 100th", () => {
    serve(lastThreadOpen().pages);
    const r = ship("merge", "79");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to merge: 1 unresolved/);
    expect(logged()).not.toMatch(/merge/);
  });

  it("resolves an open thread past the 100th", () => {
    const { pages, id } = lastThreadOpen();
    serve(pages);
    const r = ship("resolve-all", "79");
    expect(r.status, r.stderr).toBe(0);
    expect(logged()).toBe(`resolve ${id}\n`);
  });

  it("merges when every thread on every page is resolved", () => {
    serve(captured);
    expect(ship("unresolved", "79").stdout).toBe("0");
    const r = ship("merge", "79");
    expect(r.status, r.stderr).toBe(0);
    expect(logged()).toBe("merge\n");
  });

  it("fails, rather than reporting 0, when the threads cannot be read", () => {
    serve(captured);
    const r = spawnSync("bash", [script, "unresolved", "79"], {
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        FAKE_LOG: log,
        FAKE_PAGES: join(dir, "pages.jsonl"),
        FAKE_FAIL: "1",
      },
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout.trim()).not.toBe("0");
    expect(r.stderr).toMatch(/could not read the review threads of PR #79/);
  });

  it("fails when the pages read do not add up to the PR's thread count", () => {
    serve([captured[0]]); // the second page went missing
    const r = ship("unresolved", "79");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/read 100 of 108 review threads/);
  });
});

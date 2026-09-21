/**
 * check-live-apis — weekly, advisory (spec 42 §A). Hits each real endpoint
 * ONCE and asserts only the shape we depend on, so upstream drift surfaces
 * before a data refresh bakes nothing and calls it an answer.
 *
 *   npm run check:live
 *
 * It never blocks a build. On drift it opens (or updates) a GitHub issue,
 * because a red scheduled run is easy to scroll past and this repo already
 * routes things that need a human through Issues (spec 29).
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { request } from "undici";
import { nodeIO, type BuildIO } from "./lib/buildIO";
import {
  PROBES,
  summariseProbes,
  driftIssueBody,
  DRIFT_ISSUE_TITLE,
  type Probe,
  type ProbeResult,
} from "./lib/livecheck";

const here = dirname(fileURLToPath(import.meta.url));
const UA = "TrailwardBot/0.1 (+https://github.com/vivekanandba/trailward; contract check)";
const TIMEOUT_MS = 30_000;

export interface LiveCheckDeps {
  fetchOne: (probe: Probe) => Promise<string | Buffer>;
  /** Files or updates the drift issue. Omitted when there is no token. */
  fileIssue?: (title: string, body: string) => void;
}

export async function runLiveCheck(
  io: BuildIO,
  deps: LiveCheckDeps,
  probes: Probe[] = PROBES,
  runUrl?: string,
): Promise<{ results: ProbeResult[]; drifted: number; filed: boolean }> {
  const results: ProbeResult[] = [];
  for (const probe of probes) {
    try {
      results.push({ name: probe.name, verdict: probe.check(await deps.fetchOne(probe)) });
    } catch (err) {
      // A transport failure is NOT drift. Reporting "unknown" as "changed"
      // sends whoever reads this after a problem that does not exist
      // (CON-DATA-002, CON-VER-005).
      results.push({
        name: probe.name,
        verdict: { state: "unverified", detail: (err as Error).message },
      });
    }
  }

  const { text, drifted } = summariseProbes(results);
  io.log(text);

  let filed = false;
  if (drifted.length > 0 && deps.fileIssue) {
    deps.fileIssue(DRIFT_ISSUE_TITLE, driftIssueBody(results, runUrl));
    filed = true;
  }
  return { results, drifted: drifted.length, filed };
}

/** One request, bounded, with the project's User-Agent. */
async function fetchOne(probe: Probe): Promise<string | Buffer> {
  const res = await request(probe.url, {
    method: probe.body ? "POST" : "GET",
    body: probe.body,
    headers: {
      "user-agent": UA,
      ...(probe.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...probe.headers,
    },
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });
  if (res.statusCode >= 400) {
    await res.body.dump();
    throw new Error(`HTTP ${res.statusCode}`);
  }
  return probe.binary ? Buffer.from(await res.body.arrayBuffer()) : await res.body.text();
}

/**
 * Open the drift issue, or update the one that is already open. Searching by
 * the stable title is what keeps a persistent outage to one thread instead of
 * a new issue every Tuesday.
 */
function fileIssue(title: string, body: string): void {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  const found = execFileSync(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--search",
      title,
      "--json",
      "number,title",
    ],
    { encoding: "utf8" },
  );
  const open = (JSON.parse(found) as { number: number; title: string }[]).find(
    (i) => i.title === title,
  );
  if (open) {
    execFileSync("gh", ["issue", "comment", String(open.number), "--repo", repo, "--body", body], {
      stdio: "inherit",
    });
    return;
  }
  execFileSync(
    "gh",
    ["issue", "create", "--repo", repo, "--title", title, "--body", body, "--label", "upstream"],
    { stdio: "inherit" },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
  runLiveCheck(
    nodeIO,
    {
      fetchOne,
      // Without a token there is nothing to file against; say so rather than
      // failing, since the report itself is still useful locally.
      fileIssue: process.env.GITHUB_TOKEN ? fileIssue : undefined,
    },
    PROBES,
    runUrl,
  )
    .then((r) => {
      if (r.drifted > 0 && !r.filed) {
        console.log("[live] drift detected but no GITHUB_TOKEN — not filing an issue.");
      }
      // ADVISORY by design: upstream reorganising its API is not something a
      // revert here can fix, and a red scheduled run trains everyone to ignore
      // the tab. The issue is the signal.
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[live] check itself failed: ${(err as Error).message}`);
      process.exit(0);
    });
}

export { fetchOne, fileIssue, here as scriptDir, resolve as resolvePath };

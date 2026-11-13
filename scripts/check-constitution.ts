/**
 * check-constitution — the gate (spec 39). Blocks when this repo's relationship
 * to the machine-wide rules is wrong.
 *
 *   npm run check:constitution
 *   npm run sync:constitution   # refresh the pin FROM THE REMOTE
 *
 * constitution-ok: this file implements the gate and names the patterns it
 * rejects. The local clone is deliberately never consulted:
 * a working copy can sit on a feature branch with uncommitted edits, which is
 * the exact state that prompted this gate.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import {
  parseLock,
  knownRuleIds,
  findUnknownRuleIds,
  findLocalPaths,
  findCopiedText,
  exitCodeFor,
  isExempt,
  decodeGhContent,
  type ConstitutionLock,
  type RemoteStatus,
} from "./lib/constitution";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const lockFile = resolve(root, "constitution.lock");
const pinnedFile = resolve(root, ".constitution/CONSTITUTION.md");

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Files worth scanning: our own text and code, never generated artefacts. */
export function scannableFiles(): string[] {
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "test-results",
    "public",
    "src/data",
    ".constitution",
    "e2e/__screenshots__",
    "playwright-report",
    ".cache",
  ]);
  const exts = [".ts", ".tsx", ".md", ".json", ".yml", ".yaml", ".sh", ".html", ".css"];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(root, full);
      if (skip.has(rel) || skip.has(entry) || rel.startsWith("scripts/.cache")) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (exts.some((e) => entry.endsWith(e))) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * The lock to write after a sync. Pure, so the one invariant that matters is
 * testable: `commit` and `sha256` MUST move together. They did not — sync
 * updated the hash and left the commit, so the file recorded a commit whose
 * content it did not hold.
 */
export function nextLock(lock: ConstitutionLock, remote: string, commit: string): ConstitutionLock {
  return { ...lock, commit, sha256: sha256(remote) };
}

/**
 * A full commit sha, or null for anything that is not one.
 *
 * Kept separate and pure because this is the bit that matters: an HTML error
 * page, an empty body or a truncated answer are all failures dressed as
 * success, and recording any of them as the pinned commit is worse than
 * refusing to write at all.
 */
export function parseCommitSha(raw: string): string | null {
  const sha = raw.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * How to run a command, with extra environment for it. Injected so the fetch
 * policy — prefer the API when a token exists, fall back to a cache-busted raw
 * read, treat an empty body as a miss — is testable. Until this seam existed
 * nothing imported this file at all, so v8 reported it as having NO functions
 * and the coverage floor could not see it.
 */
export type Run = (cmd: string, args: string[], env?: Record<string, string>) => string;

const defaultRun: Run = (cmd, args, env) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ...env },
  });

/** Owner and repo of a GitHub URL, without a trailing `.git`; null for any other host. */
export function repoParts(url: string): { owner: string; repo: string } | null {
  const m = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * The token gh should use. gh reads GH_TOKEN (or GITHUB_TOKEN), never
 * CONSTITUTION_TOKEN, so the token CI is told to set must be handed over: a
 * gate that says "no token is set" when one is set misdiagnoses (issue #85).
 */
function ghEnv(): Record<string, string> | undefined {
  const token = process.env.CONSTITUTION_TOKEN || process.env.GH_TOKEN;
  return token ? { GH_TOKEN: token } : undefined;
}

/** Fetch CONSTITUTION.md from the REMOTE at `lock.ref`. Returns null when unreachable. */
export function fetchRemote(lock: ConstitutionLock, run: Run = defaultRun): string | null {
  const parts = repoParts(lock.repo);
  if (!parts) return null;
  const { owner, repo } = parts;
  // Prefer the API whenever a token exists: raw.githubusercontent is served
  // through a CDN that caches for minutes, so a "match" from raw can mean
  // yesterday's rules — and a verification that might be stale is not one.
  const env = ghEnv();
  if (!env) {
    try {
      const raw = run("curl", [
        "-sfL",
        "--max-time",
        "20",
        // Defeat the CDN copy; compare against the ref as it is now.
        "-H",
        "Cache-Control: no-cache",
        "-H",
        "Pragma: no-cache",
        `https://raw.githubusercontent.com/${owner}/${repo}/${lock.ref}/CONSTITUTION.md`,
      ]);
      if (raw.trim()) return raw;
    } catch {
      return null; // private, or the ref is gone — the caller reports which
    }
    return null;
  }
  try {
    return decodeGhContent(
      run(
        "gh",
        [
          "api",
          `repos/${owner}/${repo}/contents/CONSTITUTION.md?ref=${lock.ref}`,
          "--jq",
          ".content",
        ],
        env,
      ),
    );
  } catch {
    return null;
  }
}

/** The commit `lock.ref` points at now, or null when that cannot be confirmed. */
export function resolveCommit(lock: ConstitutionLock, run: Run = defaultRun): string | null {
  const parts = repoParts(lock.repo);
  if (!parts) return null;
  try {
    return parseCommitSha(
      run(
        "gh",
        ["api", `repos/${parts.owner}/${parts.repo}/commits/${lock.ref}`, "--jq", ".sha"],
        ghEnv(),
      ),
    );
  } catch {
    return null;
  }
}

/**
 * What a sync would pin: the rules and the commit they came from, or why not.
 * The commit is resolved FIRST and the rules fetched at that sha, so a ref that
 * moves between the two requests cannot pair one revision's commit with
 * another's content (issue #85).
 */
export function syncFromRemote(
  lock: ConstitutionLock,
  run: Run = defaultRun,
): { remote: string; commit: string } | string {
  const commit = resolveCommit(lock, run);
  if (!commit) {
    return (
      `could not resolve which commit ${lock.ref} points at in ${lock.repo}. Set ` +
      "CONSTITUTION_TOKEN (or make the repo public); refusing to write a lock whose commit would be a guess."
    );
  }
  const remote = fetchRemote({ ...lock, ref: commit }, run);
  if (remote === null) {
    return (
      `resolved ${lock.ref} to ${commit.slice(0, 7)} but could not read its CONSTITUTION.md. ` +
      "The local clone is deliberately not used as a fallback."
    );
  }
  return { remote, commit };
}

/** Whether we have any way to read the remote at all. */
export function accessConfigured(): boolean {
  return Boolean(
    process.env.CONSTITUTION_TOKEN || process.env.GH_TOKEN || process.env.CONSTITUTION_PUBLIC,
  );
}

function main(): void {
  const problems: string[] = [];

  if (!existsSync(lockFile)) {
    console.error("::error::constitution.lock is missing — this repo is not pinned to any ruleset");
    process.exit(1);
  }
  const lock = parseLock(readFileSync(lockFile, "utf8"));

  if (!existsSync(pinnedFile)) {
    console.error(
      "::error::.constitution/CONSTITUTION.md is missing — run npm run sync:constitution",
    );
    process.exit(1);
  }
  const pinned = readFileSync(pinnedFile, "utf8");

  // The pinned copy must be the one the lock describes — catches a local edit
  // with no network at all.
  if (sha256(pinned) !== lock.sha256) {
    problems.push(
      `.constitution/CONSTITUTION.md does not match the lock (${sha256(pinned).slice(0, 12)}… vs ` +
        `${lock.sha256.slice(0, 12)}…). It was edited locally, or the lock is stale.`,
    );
  }

  const known = knownRuleIds(pinned);
  for (const file of scannableFiles()) {
    const rel = relative(root, file);
    const text = readFileSync(file, "utf8");
    if (isExempt(text)) continue;

    for (const path of findLocalPaths(text)) {
      problems.push(`${rel}: references a LOCAL constitution path '${path}' — name the remote URL`);
    }
    for (const id of findUnknownRuleIds(text, known)) {
      problems.push(`${rel}: cites ${id}, which the constitution does not define`);
    }
    if (rel.endsWith(".md")) {
      for (const run of findCopiedText(text, pinned)) {
        problems.push(
          `${rel}: restates the constitution verbatim ("${run.slice(0, 60)}…") — cite the id`,
        );
      }
    }
  }

  // Remote verification.
  const remote = fetchRemote(lock);
  let status: RemoteStatus;
  if (remote === null) {
    status = "unreachable";
    console.warn(
      `[constitution] could not read ${lock.repo} at ${lock.ref}: the repository is private and ` +
        "no CONSTITUTION_TOKEN/GH_TOKEN is set. The pin was NOT verified against the remote.",
    );
  } else if (sha256(remote) === lock.sha256) {
    status = "match";
    console.log(
      `[constitution] verified against ${lock.repo}@${lock.ref} (${lock.commit.slice(0, 7)}).`,
    );
  } else {
    status = "mismatch";
    problems.push(
      `the remote ${lock.repo}@${lock.ref} no longer matches the pin — the rules changed. ` +
        "Run npm run sync:constitution and review the diff.",
    );
  }

  for (const p of problems) console.error(`::error::${p}`);
  const localFailed = problems.length > 0;
  const code = localFailed
    ? 1
    : exitCodeFor(status, { ci: !!process.env.CI, accessConfigured: accessConfigured() });
  if (code === 0 && !localFailed && status !== "match") {
    console.warn("[constitution] local checks passed; remote verification pending access.");
  }
  process.exit(code);
}

/** `sync` mode: refresh the pinned copy and lock FROM THE REMOTE. */
function sync(): void {
  const lock = parseLock(readFileSync(lockFile, "utf8"));
  const got = syncFromRemote(lock);
  if (typeof got === "string") {
    console.error(`::error::${got}`);
    process.exit(1);
  }
  writeFileSync(pinnedFile, got.remote, "utf8");
  const next = nextLock(lock, got.remote, got.commit);
  writeFileSync(lockFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(
    `[constitution] synced from ${lock.repo}@${lock.ref} (${got.commit.slice(0, 7)}); ` +
      "review the diff before committing.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--sync")) sync();
  else main();
}

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
function scannableFiles(): string[] {
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

/** Fetch CONSTITUTION.md from the REMOTE. Returns null when unreachable. */
export function fetchRemote(lock: ConstitutionLock): string | null {
  const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)/.exec(lock.repo) ?? [];
  if (!owner || !repo) return null;
  // Public repo: plain https, no credential. Private: gh api with a token.
  try {
    const raw = execFileSync(
      "curl",
      [
        "-sfL",
        "--max-time",
        "20",
        `https://raw.githubusercontent.com/${owner}/${repo}/${lock.ref}/CONSTITUTION.md`,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    if (raw.trim()) return raw;
  } catch {
    /* fall through to the authenticated path */
  }
  if (!process.env.CONSTITUTION_TOKEN && !process.env.GH_TOKEN) return null;
  try {
    return decodeGhContent(
      execFileSync(
        "gh",
        [
          "api",
          `repos/${owner}/${repo}/contents/CONSTITUTION.md?ref=${lock.ref}`,
          "--jq",
          ".content",
        ],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      ),
    );
  } catch {
    return null;
  }
}

const accessConfigured = (): boolean =>
  Boolean(
    process.env.CONSTITUTION_TOKEN || process.env.GH_TOKEN || process.env.CONSTITUTION_PUBLIC,
  );

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
  const remote = fetchRemote(lock);
  if (remote === null) {
    console.error(
      "::error::cannot reach the remote constitution. Set CONSTITUTION_TOKEN (or make the repo " +
        "public). The local clone is deliberately not used as a fallback.",
    );
    process.exit(1);
  }
  writeFileSync(pinnedFile, remote, "utf8");
  const next = { ...lock, sha256: sha256(remote) };
  writeFileSync(lockFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(
    `[constitution] synced from ${lock.repo}@${lock.ref}; review the diff before committing.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--sync")) sync();
  else main();
}

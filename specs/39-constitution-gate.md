<!-- constitution-ok: this spec documents the gate, so it must quote the local
     paths and example rule ids the gate rejects. -->

# 39 — The constitution is remote, and a gate enforces it

## Purpose

Machine-wide engineering rules live in a separate repository. Today this repo reaches them
through a **local clone** — `~/.claude/CLAUDE.md` is a symlink into `~/data-dash/constitution`,
and `CLAUDE.md` names that path in prose. That clone is a working copy: at the time of writing
it sat on branch `tools/cost-report` with uncommitted edits, while `origin/main` was three
commits ahead. The rules a session loads could therefore differ from the rules the team agreed,
and nothing would say so.

A symlink cannot point at a remote. What this spec establishes is weaker but sufficient and
checkable: **the local copy is never the authority**. The remote is. This repo records which
version it was verified against, and a gate fails the build when they disagree.

## A. The lock

`constitution.lock` at the repo root, committed:

```json
{
  "repo": "https://github.com/vivekanandba/constitution",
  "ref": "main",
  "commit": "<40-char sha>",
  "sha256": "<hash of CONSTITUTION.md at that commit>"
}
```

Updating the rules is one deliberate command — `npm run sync:constitution` — which fetches from
the **remote** and rewrites the lock. It never reads a local clone. The resulting diff is
reviewable, so a change to the rules is a decision, not an accident.

## B. Checks that need no network — these always hard-fail

1. **The lock exists and is well-formed**: absolute `https://` repo URL, 40-hex commit, 64-hex
   sha256.
2. **No local-clone path anywhere in the repo.** `~/data-dash/constitution`, `/home/<user>/…`,
   or any absolute filesystem path to the constitution fails the build. Prose must name the
   remote URL. This is the rule the spec exists to enforce, so it is checked first.
3. **Every `CON-<SECTION>-<NNN>` cited anywhere in this repo resolves** to a real rule in the
   pinned copy. A citation to a rule that does not exist is worse than no citation: it reads as
   authority.
4. **No copied constitution text.** The constitution's own position is that copies drift and
   citations don't. A run of ≥12 consecutive words matching the pinned copy, outside the pinned
   copy itself, fails.

## C. The check that needs the remote

Fetch `CONSTITUTION.md` from the remote at the pinned ref and compare its sha256 to the lock.

- **Match** → pass.
- **Mismatch** → **fail**. The rules moved; the PR must bump the lock deliberately and look at
  what changed.
- **Unreachable** → the repo is private today, and CI has no credential for it. In that case the
  check reports **exactly which access it lacks** and exits non-zero in CI only when access is
  configured (`CONSTITUTION_TOKEN` present, or the repo has become public). Until then it warns.
  It must never print a reassuring line it has not earned: a gate that silently passes is worse
  than no gate (CON-VER-005).

Access is a seam, not a hardcode: an unauthenticated raw URL when the repo is public, `gh api`
when a token is present. Whichever lands, only the fetch function changes.

## Edge cases & error states

- No network and no token, locally: warn, name the reason, exit 0. Developers must not be
  blocked by someone else's infrastructure.
- Lock missing entirely: hard fail — an unpinned repo has no claim to have verified anything.
- The pinned copy present but edited locally: caught by the sha256 check against the lock, which
  needs no network.
- A rule ID cited inside a code comment counts; a rule ID inside the pinned copy does not.

## Test cases (TDD checklist)

- `parseLock` accepts a valid lock; rejects a missing file, a non-https repo, a short commit, a
  malformed hash — each naming the field.
- `findLocalPaths` flags `~/data-dash/constitution` and an absolute home path; ignores the
  remote URL.
- `findUnknownRuleIds` flags `CON-FAKE-999`, accepts every ID the pinned copy defines, and does
  not flag IDs occurring inside the pinned copy itself.
- `findCopiedText` flags a pasted 12-word run; ignores a short quoted phrase.
- `verifyRemote` returns match / mismatch / unreachable, and the CLI's exit code follows the
  matrix in section C — asserted for all three, including that "unreachable" does not report
  success.
- The gate is proven by making it fail: a fabricated ID, a local path, a pasted rule, and a
  hash mismatch each break the build.

## Out of scope

Editing the constitution repo (another session owns its migration to remote); vendoring the
skills; enforcing rules' _content_ — this gate enforces that the rules are correctly referenced
and unchanged, not that the code obeys them.

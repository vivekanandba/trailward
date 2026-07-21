---
description: Raise a PR for the current work, run a reviewer↔dev review loop until clean, then approve and merge.
---

# /ship — PR review loop

Take the current change from a feature branch to a merged PR by running the
project's **review→resolve loop**: you play the reviewer (find issues, post
them on the PR), then the dev (fix them, resolve the threads), repeating until
the review is clean, then approve and merge.

The deterministic GitHub steps are in `scripts/ship.sh`; the judgement
(what to flag, how to fix) is yours. Full rationale: `docs/pr-workflow.md`.

## Procedure

1. **Branch.** If on `main`, create a feature branch first (`git switch -c
<type>/<slug>`). Never open a PR from `main` onto `main`.
2. **Commit & push** all pending work with a clear message.
3. **Open the PR and keep it open:**
   `scripts/ship.sh open` → capture the PR number. Do NOT merge yet.
4. **Review loop** — repeat, up to 5 rounds:
   1. **Reviewer role.** Run the code review and post findings as inline PR
      comments: `/code-review high --comment`.
   2. If it reports **no findings**, exit the loop.
   3. **Dev role.** Address every finding in the working tree. For each: make
      the fix (or, if you judge the comment wrong, reply on the thread saying
      why). Keep changes minimal and add/adjust tests where behaviour changed.
   4. Run the full local gate: `npm run quality:check && npm test`.
   5. **Commit & push** the fixes (this updates the same PR).
   6. **Resolve the threads** you addressed: `scripts/ship.sh resolve-all`.
   7. Loop back to re-review the new diff.
5. **Gate before merge.** Confirm `scripts/ship.sh status` shows checks
   green and `unresolved review threads: 0`. Wait for CI if it's still running.
6. **Approve** (reviewer role): `scripts/ship.sh approve`. GitHub forbids
   self-approval, so this is best-effort — the real gate is step 5.
7. **Merge:** `scripts/ship.sh merge` (squash + delete branch).
8. **Report** the PR link, rounds run, and what changed.

## Rules

- Keep the PR **open** for the whole loop — only merge in step 7.
- The loop terminates on a **clean review** (zero findings) AND **zero
  unresolved threads** AND **green checks**. Cap at 5 rounds; if still not
  clean, stop and summarise what's outstanding rather than merging.
- Never merge with red checks or unresolved threads. `ship.sh merge`
  refuses on unresolved threads as a backstop.
- If a review comment is wrong, it's valid to resolve it with a reply
  explaining why — "resolved" doesn't have to mean "code changed".

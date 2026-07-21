# PR review workflow

Every change lands through a pull request that runs a **reviewer↔dev review
loop** before it merges. Nothing goes straight to `main`.

The loop is deliberately adversarial with itself: the same agent (or person)
plays two roles in turn — a **reviewer** who tries to find problems, and a
**dev** who fixes them — and repeats until the reviewer has nothing left to
say. Then the PR is approved and squash-merged.

## The loop

```
        ┌─────────────────────────────────────────────┐
        │  open PR (kept open for the whole loop)      │
        └───────────────────────┬─────────────────────┘
                                 ▼
        ┌─────────────────────────────────────────────┐
   ┌───▶│  REVIEWER: /code-review high --comment       │
   │    │            → inline comments on the PR        │
   │    └───────────────────────┬─────────────────────┘
   │                findings?    │
   │            ┌── yes ─────────┤── no ──┐
   │            ▼                          ▼
   │  ┌───────────────────────┐   ┌────────────────────┐
   │  │ DEV: fix each finding, │   │ checks green &&    │
   │  │ test, commit, push,    │   │ 0 unresolved?      │
   │  │ resolve threads        │   └─────────┬──────────┘
   │  └──────────┬────────────┘             ▼
   └─────────────┘                 approve → squash-merge
```

Termination: a **clean review** (zero findings) **and** zero unresolved review
threads **and** green CI. Capped at 5 rounds — if it's still not clean, stop
and summarise rather than merge.

## How to run it

With Claude Code, just run the slash command from the feature branch:

```
/ship
```

It orchestrates the whole thing. The deterministic GitHub steps it leans on
live in [`scripts/ship.sh`](../scripts/ship.sh):

| Command                       | What it does                                                               |
| ----------------------------- | -------------------------------------------------------------------------- |
| `ship.sh open [base]`      | Open (or reuse) a PR from the current branch onto `base` (default `main`). |
| `ship.sh status [pr]`      | CI state, mergeability, and unresolved-thread count.                       |
| `ship.sh threads [pr]`     | List review threads with resolved/unresolved status.                       |
| `ship.sh unresolved [pr]`  | Count of unresolved review threads.                                        |
| `ship.sh resolve-all [pr]` | Resolve every open review thread.                                          |
| `ship.sh approve [pr]`     | Submit an approving review (best-effort).                                  |
| `ship.sh merge [pr]`       | Squash-merge and delete the branch (refuses if threads are unresolved).    |

The **judgement** — what to flag and how to fix it — is the reviewer's/dev's;
the script only performs the mechanical, repeatable GitHub actions.

## Notes

- **Self-approval:** GitHub does not let you formally approve your own PR, so
  `approve` is best-effort. The real merge gate is "all threads resolved + CI
  green", not the approval stamp. When a separate reviewer account is
  available, use it to approve.
- **Keep the PR open** for the entire loop; only merge at the very end.
- A review comment you disagree with can be resolved with a **reply explaining
  why** — resolving a thread doesn't require a code change.
- CI gates the merge: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
  runs validate-data, typecheck, unit tests, and e2e on every pull request, and
  `ship.sh merge` refuses unless those checks are green (or genuinely absent).
  Merging `main` then runs [`deploy.yml`](../.github/workflows/deploy.yml), which
  re-runs the same gates and redeploys the site.

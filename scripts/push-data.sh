#!/usr/bin/env bash
# Land a data commit on the branch a scheduled run started from (spec 10).
#
#   scripts/push-data.sh "<commit message>" "<recheck command>" <path>...
#
# A data run takes hours and main moves meanwhile. Rebasing alone is not
# enough: the data was derived and checked against the OLD main, and code
# merged since can change what is derived from it (the 2026-11-07 refresh
# was built before the slug registry existed and would have landed pages with
# no URL). So when the branch moved, the commit is undone, <recheck command>
# re-derives and re-checks on top of the new branch, and the result is
# committed again. A conflict, a failed recheck, or a pull that fails (a
# network blip reads as no answer, not as a conflict) exits non-zero, and the
# workflow's reporter files it.
set -euo pipefail

message="${1:?push-data: a commit message is required}"
recheck="${2:?push-data: a recheck command is required}"
shift 2
[ "$#" -gt 0 ] || { echo "push-data: no paths given" >&2; exit 2; }
branch="${GITHUB_REF_NAME:?push-data: GITHUB_REF_NAME is required}"

if [ -z "$(git status --porcelain -- "$@")" ]; then
  echo "push-data: no data changes this run."
  exit 0
fi

git config user.name "trailward-bot"
git config user.email "actions@github.com"
built_on=$(git rev-parse HEAD)
git add -- "$@"
git commit -q -m "$message"

for attempt in 1 2 3; do
  if ! git fetch -q origin "$branch"; then
    echo "push-data: could not fetch $branch (attempt $attempt)" >&2
    [ "$attempt" = 3 ] && exit 1
    sleep 10
    continue
  fi
  if [ "$(git rev-parse "origin/$branch")" != "$built_on" ]; then
    echo "push-data: $branch moved since this run began; re-deriving on top of it."
    git reset -q --soft HEAD~1
    git stash push -q --include-untracked -- "$@"
    git reset -q --hard "origin/$branch"
    if ! git stash pop -q; then
      echo "push-data: this run's data conflicts with $branch; refusing." >&2
      exit 1
    fi
    bash -c "$recheck"
    git add -- "$@"
    if [ -z "$(git diff --cached --name-only)" ]; then
      echo "push-data: nothing left to commit on top of $branch."
      exit 0
    fi
    git commit -q -m "$message"
    built_on=$(git rev-parse HEAD~1)
  fi
  if git push -q origin "HEAD:$branch"; then
    echo "push-data: pushed $(git rev-parse --short HEAD) to $branch."
    # Tell the workflow, which then dispatches the deploy: a push made with
    # the workflow's own token starts no other workflow.
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "pushed=true" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  echo "push-data: push raced another (attempt $attempt)" >&2
  [ "$attempt" = 3 ] && exit 1
  sleep 10
done

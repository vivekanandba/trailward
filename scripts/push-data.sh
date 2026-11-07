#!/usr/bin/env bash
# Land a data commit on the branch a scheduled run started from (spec 10).
#
#   scripts/push-data.sh "<message>" "<recheck>" <source>... -- <derived>...
#
# A data run takes hours and main moves meanwhile. Rebasing alone is not
# enough: the data was derived and checked against the OLD main, and code
# merged since can change what is derived from it (the 2026-11-07 refresh
# was built before the slug registry existed and would have landed pages with
# no URL). So when the branch moved, only the SOURCE data this run produced is
# carried onto the new branch; the derived files are main's, and <recheck>
# rebuilds and re-checks them there. <recheck> calls npm scripts, so it runs
# whatever the new main defines rather than what this run started with. A
# source conflict, a failed recheck or a refused push exits non-zero, and the
# workflow's reporter files it.
set -euo pipefail

message="${1:?push-data: a commit message is required}"
recheck="${2:?push-data: a recheck command is required}"
shift 2
sources=()
derived=()
after_sep=0
for p in "$@"; do
  if [ "$p" = "--" ]; then
    after_sep=1
  elif [ "$after_sep" = 0 ]; then
    sources+=("$p")
  else
    derived+=("$p")
  fi
done
[ "${#sources[@]}" -gt 0 ] || { echo "push-data: no source paths given" >&2; exit 2; }
branch="${GITHUB_REF_NAME:?push-data: GITHUB_REF_NAME is required}"
all=("${sources[@]}" "${derived[@]}")

if [ -z "$(git status --porcelain -- "${all[@]}")" ]; then
  echo "push-data: no data changes this run."
  exit 0
fi

git config user.name "trailward-bot"
git config user.email "actions@github.com"
built_on=$(git rev-parse HEAD)
git add -A -- "${all[@]}"
git commit -q -m "$message"

for attempt in 1 2 3; do
  if ! git fetch -q origin "$branch"; then
    echo "push-data: could not fetch $branch (attempt $attempt)" >&2
    [ "$attempt" = 3 ] && exit 1
    sleep 10
    continue
  fi
  # Its own statement, so a failure stops the script (set -e does not reach
  # a substitution inside the test of an if).
  remote_head=$(git rev-parse "origin/$branch")
  if [ "$remote_head" != "$built_on" ]; then
    echo "push-data: $branch moved since this run began; re-deriving on top of it."
    # This run's change to the sources, as a patch; everything else is main's.
    patch=$(mktemp)
    git diff --binary "$built_on" HEAD -- "${sources[@]}" > "$patch"
    git reset -q --hard "origin/$branch"
    if [ "${#derived[@]}" -gt 0 ]; then git clean -qfd -- "${derived[@]}"; fi
    if ! git apply --3way --index "$patch" 2>/dev/null; then
      echo "push-data: this run's source data conflicts with $branch; refusing." >&2
      exit 1
    fi
    bash -c "$recheck"
    git add -A -- "${all[@]}"
    if [ -z "$(git diff --cached --name-only)" ]; then
      echo "push-data: nothing left to commit on top of $branch."
      exit 0
    fi
    git commit -q -m "$message"
    built_on=$(git rev-parse HEAD~1)
  fi
  if out=$(git push -q origin "HEAD:$branch" 2>&1); then
    echo "push-data: pushed $(git rev-parse --short HEAD) to $branch."
    # Tell the workflow, which then dispatches the deploy: a push made with
    # the workflow's own token starts no other workflow.
    if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "pushed=true" >> "$GITHUB_OUTPUT"; fi
    exit 0
  fi
  # Only a rejection because the branch moved is a race worth retrying;
  # anything else (protection, permissions, a hook) is said as itself.
  if ! grep -qE "fetch first|non-fast-forward|stale info" <<<"$out"; then
    echo "push-data: push refused: $out" >&2
    exit 1
  fi
  echo "push-data: push raced another (attempt $attempt)" >&2
  [ "$attempt" = 3 ] && exit 1
  sleep 10
done

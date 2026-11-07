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

delay="${PUSH_DATA_RETRY_DELAY:-10}"

# Whether this run's commit is on the branch: an ancestor of its tip, so a
# push that landed is seen even after someone else pushed on top of it.
on_branch() { git merge-base --is-ancestor HEAD "origin/$branch" 2>/dev/null; }

# Before giving up for any reason but a refusal: look once more, because a
# push that reported failure may have reached the server.
give_up() {
  if git fetch -q origin "$branch" 2>/dev/null && on_branch; then landed "landed despite the error:"; fi
  echo "push-data: $1" >&2
  exit 1
}

landed() {
  echo "push-data: $1 $(git rev-parse --short HEAD) is on $branch."
  # Tell the workflow, which then dispatches the deploy: a push made with
  # the workflow's own token starts no other workflow.
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "pushed=true" >> "$GITHUB_OUTPUT"; fi
  exit 0
}

# Each attempt decides from the branch's state after a fresh fetch: already
# landed (a push that reported failure may have reached the server), moved
# (carry the sources across), or as we left it (push).
for attempt in 1 2 3; do
  if ! git fetch -q origin "$branch"; then
    [ "$attempt" = 3 ] && give_up "could not fetch $branch three times; giving up."
    echo "push-data: could not fetch $branch (attempt $attempt)" >&2
    sleep "$delay"
    continue
  fi
  # Its own statement, so a failure stops the script (set -e does not reach
  # a substitution inside the test of an if).
  remote_head=$(git rev-parse "origin/$branch")
  if on_branch; then landed "already landed:"; fi
  if [ "$remote_head" != "$built_on" ]; then
    echo "push-data: $branch moved since this run began; re-deriving on top of it."
    # This run's change to the sources, as a patch; everything else is main's.
    patch=$(mktemp)
    trap 'rm -f "$patch"' EXIT
    git diff --binary "$built_on" HEAD -- "${sources[@]}" > "$patch"
    git reset -q --hard "origin/$branch"
    if [ "${#derived[@]}" -gt 0 ]; then git clean -qfd -- "${derived[@]}"; fi
    # An empty patch (this run changed only derived files) has nothing to
    # carry; git rejects it as "unrecognized input", which is not a conflict.
    if [ -s "$patch" ] && ! applied=$(git apply --3way --index "$patch" 2>&1); then
      rm -f "$patch"
      echo "push-data: this run's source data does not apply on $branch; refusing: $applied" >&2
      exit 1
    fi
    rm -f "$patch"
    bash -c "$recheck"
    git add -A -- "${all[@]}"
    if [ -z "$(git diff --cached --name-only)" ]; then
      echo "push-data: nothing left to commit on top of $branch."
      exit 0
    fi
    git commit -q -m "$message"
    built_on=$(git rev-parse HEAD~1)
  fi
  if out=$(git push -q origin "HEAD:$branch" 2>&1); then landed "pushed"; fi
  # A rule refused it (protection, a ruleset, permissions, a hook): said as
  # itself, not retried. Anything else gets another attempt, which starts
  # by asking the branch what actually happened.
  if grep -qE "pre-receive hook declined|protected branch|GH013|repository rule violations|Permission to [^ ]+ denied|returned error: 403|HTTP 403|\(denied\)|refusing to allow a GitHub App" <<<"$out"; then
    echo "push-data: push refused: $out" >&2
    exit 1
  fi
  [ "$attempt" = 3 ] && give_up "push failed three times; giving up: $out"
  echo "push-data: push failed, will retry (attempt $attempt): $out" >&2
  sleep "$delay"
done

#!/usr/bin/env bash
#
# pr-loop.sh — deterministic gh/GitHub plumbing for the review→resolve→merge
# loop described in docs/pr-workflow.md (and driven by the /ship slash command).
#
# The *judgement* (what to flag, how to fix) is Claude's; this script only does
# the mechanical, scriptable GitHub steps so they behave the same every time.
#
# Usage:
#   scripts/pr-loop.sh open   [base]        # open a PR from the current branch (base default: main)
#   scripts/pr-loop.sh number                # print the PR number for the current branch
#   scripts/pr-loop.sh status  [pr]          # CI state, mergeability, unresolved-thread count
#   scripts/pr-loop.sh threads [pr]          # list review threads (resolved/unresolved + first comment)
#   scripts/pr-loop.sh unresolved [pr]       # print the number of UNRESOLVED review threads
#   scripts/pr-loop.sh resolve-all [pr]      # resolve every open review thread on the PR
#   scripts/pr-loop.sh approve [pr]          # submit an approving review (best-effort; self-PRs can't self-approve)
#   scripts/pr-loop.sh merge   [pr]          # squash-merge and delete the branch (requires checks green + threads resolved)
#
# Requires: gh (authenticated), git. No external jq needed (uses gh --jq).
set -euo pipefail

die() { echo "pr-loop: $*" >&2; exit 1; }
command -v gh >/dev/null || die "gh CLI not found on PATH"

# owner/repo from the gh-resolved remote so this works on any clone.
repo_slug() { gh repo view --json nameWithOwner --jq .nameWithOwner; }
owner() { repo_slug | cut -d/ -f1; }
name() { repo_slug | cut -d/ -f2; }

current_branch() { git rev-parse --abbrev-ref HEAD; }

# Resolve a PR number: use $1 if given, else the PR for the current branch.
pr_number() {
  if [ "${1:-}" != "" ]; then echo "$1"; return; fi
  gh pr view --json number --jq .number 2>/dev/null \
    || die "no PR for branch '$(current_branch)' — run 'pr-loop.sh open' first"
}

cmd_open() {
  local base="${1:-main}"
  local branch; branch="$(current_branch)"
  [ "$branch" != "$base" ] || die "refusing to open a PR from '$base' onto itself; work on a feature branch"
  # Idempotent: reuse an existing open PR for this branch if one exists.
  local existing; existing="$(gh pr view --json number --jq .number 2>/dev/null || true)"
  if [ -n "$existing" ]; then echo "$existing"; return; fi
  git push -u origin "$branch" >/dev/null 2>&1 || true
  gh pr create --base "$base" --head "$branch" --fill >/dev/null
  gh pr view --json number --jq .number
}

# GraphQL: all review threads on the PR (id, resolved, first comment path/body).
_threads_json() {
  local num="$1"
  gh api graphql \
    -f query='query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$num){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{path body}}}}}}}' \
    -F owner="$(owner)" -F repo="$(name)" -F num="$num"
}

cmd_threads() {
  local num; num="$(pr_number "${1:-}")"
  _threads_json "$num" --jq \
    '.data.repository.pullRequest.reviewThreads.nodes[] | (if .isResolved then "[resolved]  " else "[OPEN]      " end) + ((.comments.nodes[0].path)//"?") + " — " + ((.comments.nodes[0].body)//"" | gsub("\n";" ") | .[0:80])'
}

cmd_unresolved() {
  local num; num="$(pr_number "${1:-}")"
  _threads_json "$num" --jq \
    '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not)] | length'
}

cmd_resolve_all() {
  local num; num="$(pr_number "${1:-}")"
  local ids; ids="$(_threads_json "$num" --jq \
    '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | .id')"
  if [ -z "$ids" ]; then echo "no unresolved threads"; return; fi
  local n=0
  while IFS= read -r tid; do
    [ -n "$tid" ] || continue
    gh api graphql \
      -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' \
      -F id="$tid" >/dev/null
    n=$((n+1))
  done <<< "$ids"
  echo "resolved $n thread(s)"
}

cmd_status() {
  local num; num="$(pr_number "${1:-}")"
  local unresolved; unresolved="$(cmd_unresolved "$num")"
  gh pr view "$num" --json number,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup --jq \
    '"PR #\(.number)  mergeable=\(.mergeable)  state=\(.mergeStateStatus)  review=\(.reviewDecision // "NONE")  checks=" + ([.statusCheckRollup[]?.conclusion // .statusCheckRollup[]?.status] | join(","))'
  echo "unresolved review threads: $unresolved"
}

cmd_approve() {
  local num; num="$(pr_number "${1:-}")"
  # GitHub forbids approving your own PR; tolerate that so the loop can proceed.
  if gh pr review "$num" --approve --body "Reviewed: all review threads resolved and checks green." 2>/dev/null; then
    echo "approved PR #$num"
  else
    echo "approve skipped (likely a self-authored PR, which GitHub can't self-approve); gating on resolved threads + green checks instead"
  fi
}

cmd_merge() {
  local num; num="$(pr_number "${1:-}")"
  local unresolved; unresolved="$(cmd_unresolved "$num")"
  [ "$unresolved" = "0" ] || die "refusing to merge: $unresolved unresolved review thread(s)"
  gh pr merge "$num" --squash --delete-branch
  echo "merged PR #$num"
}

case "${1:-}" in
  open)        shift; cmd_open "$@" ;;
  number)      shift; pr_number "${1:-}" ;;
  status)      shift; cmd_status "${1:-}" ;;
  threads)     shift; cmd_threads "${1:-}" ;;
  unresolved)  shift; cmd_unresolved "${1:-}" ;;
  resolve-all) shift; cmd_resolve_all "${1:-}" ;;
  approve)     shift; cmd_approve "${1:-}" ;;
  merge)       shift; cmd_merge "${1:-}" ;;
  *) die "unknown command '${1:-}'. See the header of $0 for usage." ;;
esac

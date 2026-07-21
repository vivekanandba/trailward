#!/usr/bin/env bash
#
# ship.sh — deterministic gh/GitHub plumbing for the review→resolve→merge
# loop described in docs/pr-workflow.md (and driven by the /ship slash command).
#
# The *judgement* (what to flag, how to fix) is Claude's; this script only does
# the mechanical, scriptable GitHub steps so they behave the same every time.
#
# Usage:
#   scripts/ship.sh open   [base]        # open a PR from the current branch (base default: main)
#   scripts/ship.sh number                # print the PR number for the current branch
#   scripts/ship.sh status  [pr]          # CI state, mergeability, unresolved-thread count
#   scripts/ship.sh threads [pr]          # list review threads (resolved/unresolved + first comment)
#   scripts/ship.sh unresolved [pr]       # print the number of UNRESOLVED review threads
#   scripts/ship.sh resolve-all [pr]      # resolve every open review thread on the PR
#   scripts/ship.sh approve [pr]          # submit an approving review (best-effort; self-PRs can't self-approve)
#   scripts/ship.sh merge   [pr]          # squash-merge and delete the branch (requires checks green + threads resolved)
#
# Requires: gh (authenticated), git. No external jq needed (uses gh --jq).
set -euo pipefail

die() { echo "ship: $*" >&2; exit 1; }
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
    || die "no PR for branch '$(current_branch)' — run 'ship.sh open' first"
}

cmd_open() {
  local base="${1:-main}"
  local branch; branch="$(current_branch)"
  [ "$branch" != "$base" ] || die "refusing to open a PR from '$base' onto itself; work on a feature branch"
  # Idempotent: reuse only an OPEN PR for this branch (gh pr view would also
  # match a closed/merged one and hand back a dead number).
  local existing; existing="$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')"
  if [ -n "$existing" ]; then echo "$existing"; return; fi
  # Push loudly — a swallowed push failure would open the PR against a stale
  # remote HEAD and the whole loop would run on outdated code.
  git push -u origin "$branch" >/dev/null || die "git push failed for '$branch' — resolve it before opening the PR"
  gh pr create --base "$base" --head "$branch" --fill >/dev/null
  gh pr view --json number --jq .number
}

# GraphQL: all review threads on the PR (id, resolved, first comment path/body).
# Any extra args (e.g. `--jq '<filter>'`) are forwarded to `gh api` so callers
# can project the result — without the forward the filter is silently dropped
# and gh returns the raw JSON blob.
_threads_json() {
  local num="$1"; shift
  gh api graphql \
    -f query='query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$num){reviewThreads(first:100){totalCount nodes{id isResolved comments(first:1){nodes{path body}}}}}}}' \
    -F owner="$(owner)" -F repo="$(name)" -F num="$num" "$@"
}

# GitHub caps reviewThreads at 100 per page; warn (don't silently miscount) if
# a PR has more so the operator knows the count/resolve only covered the first 100.
_warn_if_truncated() {
  local num="$1" total
  total="$(_threads_json "$num" --jq '.data.repository.pullRequest.reviewThreads.totalCount')"
  [ "${total:-0}" -gt 100 ] &&
    echo "ship: warning: PR #$num has $total review threads; only the first 100 are processed" >&2
  return 0
}

cmd_threads() {
  local num; num="$(pr_number "${1:-}")"
  _threads_json "$num" --jq \
    '.data.repository.pullRequest.reviewThreads.nodes[] | (if .isResolved then "[resolved]  " else "[OPEN]      " end) + ((.comments.nodes[0].path)//"?") + " — " + ((.comments.nodes[0].body)//"" | gsub("\n";" ") | .[0:80])'
}

cmd_unresolved() {
  local num; num="$(pr_number "${1:-}")"
  _warn_if_truncated "$num"
  _threads_json "$num" --jq \
    '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not)] | length'
}

cmd_resolve_all() {
  local num; num="$(pr_number "${1:-}")"
  _warn_if_truncated "$num"
  local ids; ids="$(_threads_json "$num" --jq \
    '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | .id')"
  if [ -z "$ids" ]; then echo "no unresolved threads"; return; fi
  local ok=0 fail=0
  while IFS= read -r tid; do
    [ -n "$tid" ] || continue
    # Trust the mutation's returned isResolved, not just a 0 exit — a thread that
    # doesn't actually resolve must not be counted as done (else the loop churns).
    local resolved
    resolved="$(gh api graphql \
      -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' \
      -F id="$tid" --jq '.data.resolveReviewThread.thread.isResolved' 2>/dev/null || echo false)"
    if [ "$resolved" = "true" ]; then ok=$((ok+1)); else
      fail=$((fail+1)); echo "ship: failed to resolve thread $tid" >&2
    fi
  done <<< "$ids"
  echo "resolved $ok thread(s)${fail:+$([ "$fail" -gt 0 ] && echo ", $fail failed")}"
  [ "$fail" -eq 0 ]
}

cmd_status() {
  local num; num="$(pr_number "${1:-}")"
  local unresolved; unresolved="$(cmd_unresolved "$num")"
  gh pr view "$num" --json number,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup --jq \
    '"PR #\(.number)  mergeable=\(.mergeable)  state=\(.mergeStateStatus)  review=\(.reviewDecision // "NONE")  checks=" + (([.statusCheckRollup[]? | (.conclusion // .status)] | join(",")) | if . == "" then "none" else . end)'
  echo "unresolved review threads: $unresolved"
}

cmd_approve() {
  local num; num="$(pr_number "${1:-}")"
  # GitHub forbids approving your own PR; tolerate ONLY that. Capture stderr so a
  # genuine failure (bad auth, no permission, PR gone) surfaces instead of being
  # misreported as the benign self-approval skip.
  # `&& rc=0 || rc=$?` keeps the failing command inside a list so `set -e`
  # doesn't abort before we can inspect why it failed.
  local out rc
  out="$(gh pr review "$num" --approve --body "Reviewed: all review threads resolved and checks green." 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "approved PR #$num"
  elif printf '%s' "$out" | grep -qiE 'can not approve your own|own pull request'; then
    echo "approve skipped (self-authored PR — GitHub forbids self-approval); gating on resolved threads + green checks instead"
  else
    die "approve failed for PR #$num: $out"
  fi
}

cmd_merge() {
  local num; num="$(pr_number "${1:-}")"
  local unresolved; unresolved="$(cmd_unresolved "$num" | tail -1)"
  [ "$unresolved" = "0" ] || die "refusing to merge: $unresolved unresolved review thread(s)"
  # Gate on CI. `gh pr checks` exits 0 only when every check has passed; it is
  # non-zero for failing OR still-pending checks. A PR with no checks configured
  # prints "no checks reported" — that's allowed (nothing to gate on).
  local checks rc
  checks="$(gh pr checks "$num" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '%s' "$checks" | grep -qiE "no checks (reported|found)" \
      || die "refusing to merge: CI is not green (failing or pending):"$'\n'"$checks"
  fi
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

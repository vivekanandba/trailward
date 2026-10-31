#!/usr/bin/env bash
# Report a scheduled run's outcome where someone will see it (spec 10). A red
# scheduled run emails only whoever last edited the cron, which is how every
# weekly data refresh from 2026-08-10 to 2026-10-26 failed unseen.
#
#   GH_REPO=owner/repo RUN_URL=https://… scripts/report-failure.sh "<title>" <result>
#
#   failure → comment on the open issue with exactly this title, or open one
#   success → close that issue, if one is open, naming the run that recovered
#   anything else (cancelled, skipped) is not a verdict, and changes nothing
#
# GH_REPO, not a git checkout, names the repo. The title is matched exactly, so
# an issue that merely contains the same words never receives the alert.
set -euo pipefail

title="${1:-}"
result="${2:-failure}"
[ -n "$title" ] || { echo "report-failure: a title is required" >&2; exit 2; }
: "${GH_REPO:?report-failure: GH_REPO is required}"
run="${RUN_URL:-(run URL unknown)}"

case "$result" in
  failure | success) ;;
  *) echo "report-failure: '$result' is not a verdict; nothing to report"; exit 0 ;;
esac

# The search narrows to candidates (it is fuzzy); the jq filter decides exactly.
number=$(TITLE="$title" gh issue list --state open --limit 100 \
  --search "in:title \"$title\"" --json number,title \
  --jq '[.[] | select(.title == env.TITLE)][0].number // empty')

if [ "$result" = "success" ]; then
  [ -n "$number" ] || exit 0
  gh issue close "$number" --comment "Recovered: this scheduled run succeeded: $run"
elif [ -n "$number" ]; then
  gh issue comment "$number" --body "This scheduled run failed and changed nothing: $run"
else
  gh issue create --title "$title" --body "This scheduled run failed and changed nothing: $run"
fi

#!/usr/bin/env bash
# File a failed scheduled run where someone will see it (spec 10): comment on
# the open issue with exactly this title, or open one. A red scheduled run
# emails only whoever last edited the cron, which is how every weekly data
# refresh from 2026-08-10 to 2026-10-26 failed unseen.
#
#   GH_REPO=owner/repo RUN_URL=https://… scripts/report-failure.sh "<title>"
#
# GH_REPO, not the git checkout, names the repo: the step that failed may have
# been the checkout itself. The title is matched exactly, so an issue that
# merely contains the same words never receives the alert.
set -euo pipefail

title="${1:-}"
[ -n "$title" ] || { echo "report-failure: a title is required" >&2; exit 2; }
: "${GH_REPO:?report-failure: GH_REPO is required}"
body="This scheduled run failed and changed nothing: ${RUN_URL:-(run URL unknown)}"

number=$(TITLE="$title" gh issue list --state open --limit 200 --json number,title \
  --jq '[.[] | select(.title == env.TITLE)][0].number // empty')

if [ -n "$number" ]; then
  gh issue comment "$number" --body "$body"
else
  gh issue create --title "$title" --body "$body"
fi

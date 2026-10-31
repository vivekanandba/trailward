#!/usr/bin/env bash
# Report a scheduled run's outcome where someone will see it (spec 10). A red
# scheduled run emails only whoever last edited the cron, which is how every
# weekly data refresh from 2026-08-10 to 2026-10-26 failed unseen.
#
#   GH_REPO=owner/repo RUN_URL=https://… scripts/report-failure.sh "<title>" <result>
#
#   failure, cancelled → comment on the open issue with exactly this title, or
#                        open one. A scheduled run is cancelled by a timeout or a
#                        runner that never came, and twelve silent weeks is the
#                        incident this exists for.
#   success → close that issue, if one is open, naming the run that recovered
#   skipped → not a verdict; nothing changes
#
# GH_REPO, not a git checkout, names the repo. The title is matched exactly, so
# an issue that merely contains the same words never receives the alert.
set -euo pipefail

title="${1:-}"
result="${2:-}"
[ -n "$title" ] || { echo "report-failure: a title is required" >&2; exit 2; }
# An empty result means the caller could not name the work job's outcome (a
# renamed job, say). That is not a failure, and saying so would be wrong.
[ -n "$result" ] || { echo "report-failure: no result given; cannot tell what happened" >&2; exit 2; }
: "${GH_REPO:?report-failure: GH_REPO is required}"
run="${RUN_URL:-(run URL unknown)}"

# A cancelled run is filed like a failure, but said as what it was.
what="failed"
case "$result" in
  failure | success) ;;
  cancelled) result=failure what="was cancelled (a timeout, a runner that never came, or by hand)" ;;
  *) echo "report-failure: '$result' is not a verdict; nothing to report"; exit 0 ;;
esac

# Every open issue, through the REST list rather than search: the search index
# lags a just-filed issue, so a quick re-run would open a duplicate. Only those
# a bot filed (`user.type == "Bot"`, which an outside account on this public
# repo cannot be and an edit cannot remove), so a person's issue with the same
# title is never commented on or closed as "recovered". Pull requests drop out.
numbers=$(TITLE="$title" gh api --paginate "repos/$GH_REPO/issues?state=open&per_page=100" \
  --jq '.[] | select(.pull_request == null and .title == env.TITLE
    and .user.type == "Bot") | .number')
number=$(printf '%s\n' "$numbers" | sed -n 1p)

if [ "$result" = "success" ]; then
  # Every match: a duplicate left open would say the job is still failing.
  for n in $numbers; do
    gh issue close "$n" --comment "Recovered: this scheduled run succeeded: $run"
  done
elif [ -n "$number" ]; then
  gh issue comment "$number" --body "This scheduled run $what: $run"
else
  gh issue create --title "$title" --body "This scheduled run $what: $run"
fi

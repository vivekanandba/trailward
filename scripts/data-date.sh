#!/usr/bin/env bash
# The date the data last changed, for the static pages' "Data as of" and the
# sitemap's lastmod (spec 44 R5), exported to the job as TRAILWARD_DATA_DATE.
# Run through .github/actions/data-date by every job that builds the pages, so
# a new job cannot copy half of it (issue #94: #89 missed two of four copies).
#
# A shallow clone's only commit is the one being deployed, so its "last change"
# is today: refuse it rather than print a confident wrong date, and refuse an
# empty or malformed answer rather than export a blank (CON-VER-005).
set -euo pipefail

file=src/data/treks.json
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  echo "::error::data-date: this clone is shallow, so $file's history is cut off; check out with fetch-depth: 0" >&2
  exit 1
fi
date="$(git log -1 --format=%cs -- "$file")"
if ! [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "::error::data-date: could not read when $file last changed (got '$date')" >&2
  exit 1
fi
echo "TRAILWARD_DATA_DATE=$date" >> "${GITHUB_ENV:?data-date: GITHUB_ENV is not set}"
echo "data-date: $file last changed $date"

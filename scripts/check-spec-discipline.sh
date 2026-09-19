#!/usr/bin/env bash
# Spec discipline (spec 37). A change to the data contract or to any pipeline
# script must carry a specs/ edit in the same PR.
#
# Why this exists as a CI step and not only in /ship: a spec validator can
# check the specs that EXIST, but it structurally cannot see the one that is
# missing. This is the only gate that catches an absent spec.
#
# Lives in a script, not inline YAML, so the pattern is testable — an
# unenforced gate reads as protection while providing none, which is worse
# than no gate at all.
set -uo pipefail

BASE="${1:-origin/main}"

# Files whose behaviour is specified before it changes. Deliberately broad:
# every pipeline script, not just the build-* ones, because a silent change in
# discover-precompute or the drift guard is exactly as costly.
SPEC_REQUIRING='^(src/lib/trek\.ts|scripts/[a-z0-9-]+\.ts)$'

# Pipeline scripts only — lib/ helpers and one-off migrations are covered by
# the spec of the tool that uses them.
EXEMPT='^scripts/(lib/|seed/|check-spec-discipline)'

changed="$(git diff --name-only "${BASE}...HEAD" 2>/dev/null)"
if [ -z "$changed" ]; then
  echo "::warning::could not resolve ${BASE}; skipping the spec check"
  exit 0
fi

needs_spec="$(echo "$changed" | grep -E "$SPEC_REQUIRING" | grep -vE "$EXEMPT" || true)"
[ -z "$needs_spec" ] && { echo "No spec-requiring files changed."; exit 0; }

if echo "$changed" | grep -qE '^specs/'; then
  echo "Spec-requiring changes carry a specs/ edit:"
  echo "$needs_spec"
  exit 0
fi

echo "::error::These changed without any specs/ edit:"
echo "$needs_spec"
echo "The data contract and the pipeline are specified before they change (specs/README.md)."
exit 1

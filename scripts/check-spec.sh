#!/usr/bin/env bash
#
# "Does this change need a spec, and does it have one?"
#
# One implementation, called by both the local git hook and CI. The rule used to
# live only in a GitHub workflow, which meant it could not tell you anything
# until after you had pushed -- and stopped applying at all if you moved off
# GitHub.
#
#   scripts/check-spec.sh --staged                  # what is about to be committed
#   scripts/check-spec.sh --range origin/main..HEAD # what is about to be pushed
#   scripts/check-spec.sh --files-from list.txt     # explicit list (CI)
#
# Optional context, both used by CI:
#   --body "<pr body>"      a 'specs/NNN-name' reference in here counts
#   --labels "a,b"          the 'no-spec-needed' label waives the check
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

MODE=""
RANGE=""
FILES_FROM=""
BODY="${SPEC_CHECK_BODY:-}"
LABELS="${SPEC_CHECK_LABELS:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --staged)     MODE=staged ;;
    --range)      MODE=range; RANGE="$2"; shift ;;
    --files-from) MODE=files; FILES_FROM="$2"; shift ;;
    --body)       BODY="$2"; shift ;;
    --labels)     LABELS="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$MODE" in
  staged) CHANGED="$(git diff --cached --name-only --diff-filter=ACMR)" ;;
  range)  CHANGED="$(git diff --name-only --diff-filter=ACMR "$RANGE")" ;;
  files)  CHANGED="$(cat "$FILES_FROM")" ;;
  *) echo "usage: check-spec.sh --staged | --range <a..b> | --files-from <file>" >&2; exit 2 ;;
esac

# Only source changes need a spec. Tests, docs, CI and config do not --
# requiring one there just trains people to write filler.
BEHAVIOUR="$(printf '%s\n' "$CHANGED" \
  | grep -E '^(server/[^/]+\.py|client/src/)' \
  | grep -vE '(^server/test_|^server/conftest\.py|\.spec\.js$)' || true)"

if [ -z "$BEHAVIOUR" ]; then
  echo "spec-check: no behaviour change; spec not required."
  exit 0
fi

echo "spec-check: behaviour changes here —"
printf '%s\n' "$BEHAVIOUR" | sed 's/^/  /'

if printf '%s' "$LABELS" | tr ',' '\n' | grep -qx 'no-spec-needed'; then
  echo "spec-check: waived by the no-spec-needed label."
  exit 0
fi

if printf '%s\n' "$CHANGED" | grep -q '^specs/.*\.md$'; then
  echo "spec-check: this change updates a spec —"
  printf '%s\n' "$CHANGED" | grep '^specs/.*\.md$' | sed 's/^/  /'
  exit 0
fi

REFERENCED="$(printf '%s' "$BODY" | grep -oE 'specs/[0-9]{3}-[a-z0-9-]+' | head -1 || true)"
if [ -n "$REFERENCED" ]; then
  if [ -d "$REFERENCED" ]; then
    echo "spec-check: references an existing spec — $REFERENCED"
    exit 0
  fi
  echo "spec-check: FAILED — references $REFERENCED, but no such directory exists." >&2
  exit 1
fi

cat >&2 <<'EOF'

spec-check: FAILED — this changes behaviour and has no spec.

  Write one:      specs/NNN-name/spec.md   (see specs/README.md)
  Or reference:   put "Spec: specs/NNN-name/spec.md" in the PR body
  Or waive it:    SPEC_CHECK_LABELS=no-spec-needed  (label on the PR in CI)

Versioning shipped wrong because the code did exactly what I intended and my
intent was never written down for anyone to check. That is what this catches.

To bypass once (it will still be checked in CI):  git commit --no-verify
EOF
exit 1

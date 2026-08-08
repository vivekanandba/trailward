#!/usr/bin/env bash
#
# Commit-message gate — specs/018-message-and-merge-gates.
#
# The diff already says what changed. Only the message can say why, and the
# "Defects found after shipping" tables in specs/ are reconstructable only where
# someone wrote it down. The commits in this history that are hardest to explain
# are, without exception, the ones whose message was `wip:` or a bare subject.
#
# This rejects the *absence of meaning*, not phrasing. It is not a style guide:
# no Conventional Commits, no imperative-mood policing.
#
#   scripts/check-message.sh <file>     # what commit-msg passes in
#
# Bypass: git commit --no-verify
set -uo pipefail

cd "${HYGIENE_REPO:-$(git rev-parse --show-toplevel)}" || exit 2

FILE="${1:-}"
[ -f "$FILE" ] || exit 0

MAX_SUBJECT="${MAX_SUBJECT_CHARS:-72}"

# Comments are git's template, not content.
BODY_TEXT="$(grep -v '^#' "$FILE" 2>/dev/null || true)"
SUBJECT="$(printf '%s\n' "$BODY_TEXT" | sed '/^[[:space:]]*$/d' | head -1)"
[ -z "$SUBJECT" ] && exit 0   # empty message: git aborts anyway

fail() { printf '\n\033[31mblocked:\033[0m %s\n' "$1" >&2; }
note() { printf '  %s\n' "$1" >&2; }

# Git writes these itself; rejecting them just breaks rebase and revert.
case "$SUBJECT" in
  Merge\ *|Revert\ *|fixup!\ *|squash!\ *|amend!\ *) exit 0 ;;
esac

# --- placeholder subjects -----------------------------------------------------
NORMALISED="$(printf '%s' "$SUBJECT" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/^(wip|chore|fix|misc)[:!]?[[:space:]]*//; s/[[:space:][:punct:]]+$//')"
case "$NORMALISED" in
  ""|wip|fix|fixes|fixed|update|updates|updated|stuff|things|changes|change|misc|temp|tmp|test|asdf)
    fail "\"$SUBJECT\" does not say anything."
    note "Say what changed and, in the body, why it needed to."
    exit 1 ;;
esac

# --- subject length -----------------------------------------------------------
if [ "${#SUBJECT}" -gt "$MAX_SUBJECT" ]; then
  fail "the subject is ${#SUBJECT} characters; keep it to $MAX_SUBJECT."
  note "It is truncated in git log, GitHub and every other tool that shows it."
  note "Move the detail into the body."
  exit 1
fi

# --- a source change needs a body ---------------------------------------------
# Docs, tests and config are exempt: "Correct a typo in the deploy notes" is a
# complete and honest message, and demanding a body there would teach people to
# pad it.
STAGED="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
SOURCE="$(printf '%s\n' "$STAGED" \
  | grep -E '\.(py|js|jsx|ts|tsx|vue|go|rs|java|rb|sh|sql)$' \
  | grep -vE '(^|/)(test_|tests?/)|\.spec\.|\.test\.|(^|/)docs?/' || true)"

if [ -n "$SOURCE" ]; then
  BODY="$(printf '%s\n' "$BODY_TEXT" | tail -n +2 | sed '/^[[:space:]]*$/d')"
  # Trailers are metadata, not an explanation.
  BODY="$(printf '%s\n' "$BODY" | grep -viE '^[A-Za-z-]+:[[:space:]]*(https?://|<|[A-Z])' || true)"
  if [ -z "$BODY" ]; then
    fail "this changes source but the message has no body."
    note "The diff already says what. Write a line or two on why."
    note "Files: $(printf '%s' "$SOURCE" | tr '\n' ' ' | cut -c1-60)"
    exit 1
  fi
fi

exit 0

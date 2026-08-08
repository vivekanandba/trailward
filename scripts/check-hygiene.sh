#!/usr/bin/env bash
#
# Local hygiene gates — specs/017-local-hygiene-gates.
#
# Branch protection is unavailable on this repo, so everything worth enforcing
# runs here or not at all. Every gate below exists because the thing it prevents
# already happened in this project; none of it is speculative hardening.
#
# Reads *staged* content only, and runs no tests, so it stays near-instant. A
# slow pre-commit hook gets bypassed habitually, which is worse than no hook.
#
#   scripts/check-hygiene.sh          # checks the index (what pre-commit runs)
#
# Escape hatches, all deliberate:
#   git commit --no-verify            # skip every gate once
#   # nondeterminism-ok: <reason>     # allow one ordering-dependent line
#   hygiene-ok: <reason>              # allow a whole file (e.g. these gates' tests)
#   -- backup: <dump>                 # allow a destructive migration
set -uo pipefail

cd "${HYGIENE_REPO:-$(git rev-parse --show-toplevel)}" || exit 2

PROTECTED="${PROTECTED_BRANCHES:-main master}"
MAX_BYTES="${MAX_FILE_BYTES:-524288}"
FAILED=0

fail() { printf '\n\033[31mblocked:\033[0m %s\n' "$1"; FAILED=1; }
note() { printf '  %s\n' "$1"; }

STAGED="$(git diff --cached --name-only --diff-filter=ACMR)"
[ -z "$STAGED" ] && exit 0

# --- 1. protected branch ------------------------------------------------------
# I committed straight to main three times, once while building these hooks.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
for protected in $PROTECTED; do
  if [ "$BRANCH" = "$protected" ]; then
    fail "you are on '$BRANCH'. Work belongs on a branch."
    note "git branch feat/my-change"
    note "git reset --soft HEAD  # keep the staged work"
    note "git checkout feat/my-change"
  fi
done

# --- 2. secrets ---------------------------------------------------------------
# A GCP service account key was pasted into a conversation twice this project.
# Nothing would have stopped it being committed.
#
# Placeholders must pass, or the gate trains people to ignore it. A value is
# treated as a placeholder when it is obviously redacted or is an env lookup.
is_placeholder() {
  printf '%s' "$1" | grep -qiE '(\.\.\.|xxx+|redacted|placeholder|example|changeme|<[a-z_ -]+>|\$\{?[A-Z_]+|os\.environ|process\.env|getenv)'
}

# A file may declare itself an intentional exception -- the tests for these very
# gates must contain example keys and ordering-dependent lines, or they would be
# testing nothing. The marker is explicit, greppable, and demands a reason:
#   hygiene-ok: <why this file legitimately contains these patterns>
declares_exception() {
  printf '%s' "$1" | grep -qE 'hygiene-ok:[[:space:]]*[^[:space:]]'
}

scan_secrets() {
  local file="$1" content="$2" line
  declares_exception "$content" && return
  # Private key blocks and service-account JSON are never legitimate here.
  if printf '%s' "$content" | grep -qE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----'; then
    fail "$file contains a private key block."
    note "Remove it, and rotate the key — anything that reached disk is compromised."
    return
  fi
  if printf '%s' "$content" | grep -qE '"type"[[:space:]]*:[[:space:]]*"service_account"'; then
    fail "$file looks like a GCP service account key."
    note "Use Workload Identity Federation. Rotate this key if it ever existed."
    return
  fi
  # Token-shaped values, unless clearly redacted.
  while IFS= read -r line; do
    is_placeholder "$line" && continue
    fail "$file has what looks like a live credential."
    note "$(printf '%s' "$line" | cut -c1-72)"
    note "Move it to Secret Manager, and rotate it — assume it is compromised."
    return
  done < <(printf '%s' "$content" | grep -E \
      -e 'sk-[A-Za-z0-9_-]{24,}' \
      -e '(postgres|postgresql)://[^:/@[:space:]]+:[^@[:space:]]{8,}@' \
      -e '(api[_-]?key|secret|token|password)[[:space:]]*[:=][[:space:]]*['"'"'"][A-Za-z0-9_/+-]{20,}['"'"'"]' \
      || true)
}

# --- 3. determinism -----------------------------------------------------------
# Counter.most_common() broke ties in set-iteration order: three workers, three
# different resumes, and a tracked score that moved on its own. Five days to
# notice. Only *added* lines are examined, so existing code need not be rewritten.
scan_determinism() {
  local file="$1" line
  declares_exception "$(git show ":$file" 2>/dev/null || true)" && return
  while IFS= read -r line; do
    line="${line#+}"
    case "$line" in *"nondeterminism-ok:"*) continue ;; esac
    if printf '%s' "$line" | grep -qE '\.most_common\(\)|\b(list|sorted)\(set\(|\bset\([^)]*\)\.pop\(\)|\blist\([a-z_]+\)\[[0-9:]'; then
      fail "$file adds ordering-dependent code:"
      note "$(printf '%s' "$line" | sed 's/^[[:space:]]*//' | cut -c1-72)"
      note "Break ties on an explicit key, or mark it '# nondeterminism-ok: <reason>'."
      return
    fi
  done < <(git diff --cached -U0 -- "$file" | grep '^+' | grep -v '^+++' || true)
}

# --- 4. migrations ------------------------------------------------------------
# 0005 blanked data and was safe only because a fresh dump was taken first,
# having noticed the weekly one predated the affected rows. Nothing enforced it.
check_migration() {
  local file="$1" content="$2"
  if printf '%s' "$content" \
      | grep -viE '^[[:space:]]*--' \
      | grep -qiE '\b(DROP|DELETE[[:space:]]+FROM|TRUNCATE)\b|\bUPDATE\b.*\bSET\b'; then
    if ! printf '%s' "$content" | grep -qiE '^[[:space:]]*--.*backup'; then
      fail "$file is destructive but does not name a backup."
      note "Take a dump, confirm it covers the affected rows, then add:"
      note "-- backup: <dump name> taken immediately before this."
    fi
  fi
}

check_duplicate_migrations() {
  # Directory varies by project: server/migrations here, backend/migrations and
  # accounts/migrations elsewhere. Match on the shape, not one repo's layout.
  local dupes
  dupes="$( { git ls-files '*migrations/*.sql'; printf '%s\n' "$STAGED" | grep -E 'migrations/.*\.sql$'; } \
            | sort -u | sed -n 's|.*/\([0-9]\{3,4\}\)[_-].*|\1|p' | sort | uniq -d)"
  if [ -n "$dupes" ]; then
    fail "two migrations share a number: $(printf '%s' "$dupes" | tr '\n' ' ')"
    note "They would apply in ambiguous order. Renumber one."
  fi
}

# --- 5. binaries --------------------------------------------------------------
# The master .docx lives in Postgres; renditions are generated. Neither belongs
# in git history, where it cannot be removed later.
check_binary() {
  local file="$1" size
  size="$(git cat-file -s "$(git rev-parse ":$file" 2>/dev/null)" 2>/dev/null || echo 0)"
  if [ "$size" -gt "$MAX_BYTES" ]; then
    fail "$file is ${size} bytes (limit ${MAX_BYTES})."
    note "Large artifacts belong in storage, not in git history."
    return
  fi
  case "$file" in
    docs/*) return ;;
    *.docx|*.pdf|*.dump)
      fail "$file is a generated/binary artifact outside docs/."
      note "The master .docx lives in Postgres; renditions are generated on demand."
      ;;
  esac
}

# --- run ----------------------------------------------------------------------
while IFS= read -r file; do
  [ -z "$file" ] && continue
  check_binary "$file"

  # Skip content scanning for anything that is not text.
  if git diff --cached --numstat -- "$file" | grep -q '^-'; then
    continue  # binary: numstat reports '-' for added/removed lines
  fi
  content="$(git show ":$file" 2>/dev/null || true)"
  [ -z "$content" ] && continue

  scan_secrets "$file" "$content"
  case "$file" in
    *.py) scan_determinism "$file" ;;
  esac
  case "$file" in
    *migrations/*.sql) check_migration "$file" "$content" ;;
  esac
done <<< "$STAGED"

printf '%s\n' "$STAGED" | grep -qE 'migrations/.*\.sql$' && check_duplicate_migrations

if [ "$FAILED" -ne 0 ]; then
  printf '\nTo bypass deliberately: git commit --no-verify\n'
  exit 1
fi
exit 0

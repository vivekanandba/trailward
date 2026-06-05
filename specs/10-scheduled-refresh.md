# 10 — Scheduled Refresh

## Purpose

Keep trek data current automatically, with **no server**: a weekly GitHub Actions cron re-runs the
pipeline, commits changes, and lets the gated deploy publish them.

## User stories

- As the **maintainer**, I want the data to refresh on its own so I don't have to remember.
- As the **maintainer**, I want to trigger a refresh on demand, and to know if a run failed.
- As a **visitor**, I want reasonably current info without the site ever calling a backend.

## Acceptance criteria

- **Given** the schedule `0 2 * * 1` (Mondays 02:00 UTC), **when** it fires, **then** the workflow
  runs `build:data`, validates the output, and **commits `treks.json` only if it changed**.
- **Given** a commit happens, **when** pushed to `main`, **then** the gated deploy workflow (09)
  runs and republishes only if data + tests pass.
- **Given** `workflow_dispatch`, **when** triggered manually, **then** the same refresh runs.
- **Given** a pipeline failure, **when** the run ends, **then** the workflow fails visibly (red
  run, optional notification), and **no broken data is committed**.

## Interfaces & data contracts

- `.github/workflows/refresh-data.yml` with `permissions: contents: write`, steps: checkout →
  setup-node → `npm ci` → `npm run build:data` → `npm run validate:data` → commit-if-changed.
- Commits authored by a bot identity with message `chore(data): weekly refresh of treks.json`.

## Edge cases & error states

- No changes this week → no commit, no redeploy (logged "No data changes").
- Validation fails after build → job fails **before** committing; last good data stays live.
- Source outage → pipeline skips optional fields (per 02); only a structural failure blocks.
- Avoid infinite loops: the data-commit triggers deploy, not another refresh.

## Test cases (TDD checklist)

- Pipeline runs headless (mocked or live-allowed) in CI and produces a valid file.
- "Commit only if changed": given identical output, no commit is made (script/unit test of the
  diff gate).
- A forced validation failure causes a non-zero exit before any commit.

## Out of scope

- Deploy mechanics (→ 09). Curating new cities (a manual/dispatch pipeline run).

## Open questions

- Failure alerts: rely on GitHub's default failed-run email, or add a Slack/webhook ping? (Lean:
  default email for v1.)
- Cadence confirmed weekly — bump to daily only if data proves to change faster.

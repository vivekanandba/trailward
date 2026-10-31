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
- **Given** a pipeline failure, **when** the run ends, **then** the workflow fails visibly, **opens
  (or comments on) one issue titled "Weekly data refresh is failing"**, and **no broken data is
  committed**.
- **Given** the committed dataset, **when** `build:data` runs, **then** it replaces only the
  curated tier and keeps every other record as it was, because `build:discovery` reads that file
  as the previous dataset to preserve enrichment from.
- **Given** a curated record, **when** this run's enricher returns nothing for a field it supplied
  before (a photo, a road distance), **then** the previous value is kept. A failed or changed
  lookup is not evidence the value is gone. Fields the seed states come from this run's seed
  only, so a field removed from the seed is removed.
- **Given** a Wikipedia title that is now a disambiguation page, **when** the build reads it,
  **then** it takes nothing from it.

## Interfaces & data contracts

- `.github/workflows/refresh-data.yml` with `permissions: contents: write, issues: write`, steps:
  checkout → setup-node → `npm ci` → `npm run build:data` → `npm run build:discovery` →
  `npm run validate:data` → the drift guard (`check-enrichment-drift.ts`, spec 31) →
  `build:chunks` → commit-if-changed; on failure, file the issue.
- `foldCurated(built, existing)` (`scripts/build-data.ts`) is the pure fold `build:data` writes.
- Commits authored by a bot identity with message `chore(data): weekly refresh of treks.json`.

## Edge cases & error states

- No changes this week → no commit, no redeploy (logged "No data changes").
- Validation fails after build → job fails **before** committing; last good data stays live.
- Source outage → pipeline skips optional fields (per 02); only a structural failure blocks.
- Avoid infinite loops: the data-commit triggers deploy, not another refresh.

- **Incident, 2026-08-10 → 2026-10-26: every weekly run failed and nobody saw it.** `build:data`
  wrote `treks.json` with only the 16 curated records, so `build:discovery` preserved enrichment
  from a file that no longer held any (bestSeason 120,187 → 16, landCover → 0). The drift guard
  refused all twelve runs, which is why nothing broken shipped. But a red scheduled run emails only
  whoever last edited the cron, so the data simply stopped refreshing. Hence the fold, and the
  issue on failure. The same rerun also showed six curated photos vanishing because their
  Wikipedia lookups stopped returning one (Nandi Hills became a disambiguation page), which the
  guard did not count; it now counts `image`.

## Test cases (TDD checklist)

- Pipeline runs headless (mocked or live-allowed) in CI and produces a valid file.
- "Commit only if changed": given identical output, no commit is made (script/unit test of the
  diff gate).
- A forced validation failure causes a non-zero exit before any commit.
- `scripts/build-data.test.ts` → `foldCurated`: non-curated records kept exactly; baked fields
  carried; seed fields from this run only; an enricher's missing value kept; a removed seed
  dropped.
- `scripts/sources/parsers.test.ts`: a disambiguation page yields nothing.
- `scripts/build-tools.test.ts`: the drift guard counts `image`.
- After merge: dispatch the refresh and read back a green run (CON-VER-003).

## Out of scope

- Deploy mechanics (→ 09). Curating new cities (a manual/dispatch pipeline run).

## Open questions

- ~~Failure alerts: rely on GitHub's default failed-run email?~~ Answered by the incident above:
  no. A failed run files an issue.
- Cadence confirmed weekly — bump to daily only if data proves to change faster.

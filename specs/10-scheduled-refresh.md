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
- **Given** any scheduled workflow (refresh, name suggestions, link check, live API check),
  **when** its work job ends, **then** a separate `report-failure` job reports the result: a
  **failure** opens, or comments on, the one open issue with exactly that workflow's title; a
  later **success** closes it, naming the run that recovered; a cancelled or skipped run changes
  nothing. A failed refresh commits no data. In refresh-data and weekly-links the work job holds
  no issues-write token; apply-suggestions and weekly-live-apis hold one for their own work
  (closing suggestion issues, filing drift).
- **Given** the committed dataset, **when** `build:data` runs, **then** it replaces only the
  curated tier and keeps every other record exactly, because `build:discovery` reads that file
  as the previous dataset to preserve enrichment from.
- **Given** a curated record, **then** each field is decided by its owner (`OWNER` in
  `scripts/build-data.ts`, a record over every key of `Trek`, so a new field does not compile
  until it is classified):
  - **`run`** fields (what the seed may state, including `highlights`, `elevationM` and
    `permitRequired`, which an enricher may also fill) come from this run alone: the seed, then
    this run's enrichers. One removed from the seed is removed.
  - **`place`** fields (terrain, land cover, gazetteer, hill features, road distance and drive
    time, and `bestSeason`, which `build:climate` bakes onto a seed that states none) keep their
    previous value when this run produced none, **while the seed is within 120 m of where it
    was** (`CARRYOVER_KM`, the distance discovery uses for a rescanned summit).
  - **`sources`** (the photo) is kept on the same condition **and** only while the seed cites
    the same sources. A failed or changed lookup is not evidence the photo is gone; a different
    article is.
- **Given** a new seed with the id of an existing discovery pin, **then** the curated record
  replaces the pin, taking what was baked for that place, rather than duplicating the id.
- **Given** a curated record, **then** its keys keep their previous order, so a refresh that
  changed nothing rewrites nothing.
- **Given** a Wikipedia title that is now a disambiguation page, **when** the build reads it,
  **then** it takes nothing from it.

## Interfaces & data contracts

- `.github/workflows/refresh-data.yml` (`permissions: contents: write`): checkout → setup-node →
  `npm ci` → `npm run build:data` → `npm run build:discovery` → `npm run validate:data` → the
  drift guard (`check-enrichment-drift.ts`, spec 31) → `build:chunks` → commit-if-changed.
- Commits authored by the bot identity `trailward-bot` with message `chore(data): weekly refresh
of treks.json`.
- Every scheduled workflow ends with a `report-failure` job (`needs:` the work, `if: always()`,
  job-level `contents: read, issues: write`) that calls `.github/workflows/report-failure.yml`
  with the work job's result. It runs `scripts/report-failure.sh "<title>" <result>` with
  `GH_REPO` set, so it names the repo without relying on the work job's checkout, and passes the
  title through `env`.
- `runBuildData(io, file, seeds, origin, enrichers)` is the whole `build:data` run against a
  filesystem; `foldCurated(built, existing)` is its pure fold.

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
  guard did not count. The fold now keeps them, and the guard counts `image` so a bulk photo loss
  elsewhere is caught (it tolerates up to 5 records, like every field).

## Test cases (TDD checklist)

- Pipeline runs headless (mocked or live-allowed) in CI and produces a valid file.
- "Commit only if changed": given identical output, no commit is made (script/unit test of the
  diff gate).
- A forced validation failure causes a non-zero exit before any commit.
- `scripts/build-data.test.ts` → `foldCurated`: non-curated records kept exactly; `place` fields
  carried; nothing carried across a corrected position; the photo dropped when the cited article
  changes; a `run` field (`permitRequired`) dropped when no longer given; key order kept; a
  removed seed dropped. `runBuildData`: the written file keeps every discovery record.
- `scripts/sources/parsers.test.ts`: a disambiguation page yields nothing.
- `scripts/build-tools.test.ts`: the drift guard counts `image` and fails on a bulk photo loss.
- `scripts/report-failure.test.ts` (fake `gh`): opens an issue when none matches, comments on
  the exact-title match, ignores a title that merely contains the words, closes the issue on a
  later success, does nothing on success with none open or for a cancelled or skipped run,
  narrows the lookup with an `in:title` search, refuses no title.
- `scripts/build-data.test.ts` also: a best season `build:climate` baked survives; a seed that
  promotes a discovery pin replaces it; key order holds even when the built record's keys come
  in a different order.
- After merge: dispatch the refresh and read back a green run (CON-VER-003).

## Out of scope

- Deploy mechanics (→ 09). Curating new cities (a manual/dispatch pipeline run).

## Open questions

- ~~Failure alerts: rely on GitHub's default failed-run email?~~ Answered by the incident above:
  no. A failed run files an issue.
- Cadence confirmed weekly — bump to daily only if data proves to change faster.

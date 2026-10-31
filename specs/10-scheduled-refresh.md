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
  **failure** opens, or comments on, the one open issue with exactly that workflow's title,
  saying only that the run failed (what it changed before failing is not known there); a later
  **success** closes it, naming the run that recovered; a **cancelled** run (a timeout, a runner
  that never came) is filed like a failure; a skipped run changes nothing; a missing result fails the reporter job rather than being reported as a failure.
  A checker that is advisory about what it finds (dead links, API drift) still exits non-zero
  when it **crashes**, and the live check exits non-zero when it found drift but **could not
  file** the drift issue, so the reporter never reads either as success and closes an open issue
  as recovered.
  Only runs on `main` report, so a dispatch on a branch neither files nor closes the issue. A failed refresh commits no data. In refresh-data and weekly-links the work job holds
  no issues-write token; apply-suggestions and weekly-live-apis hold one for their own work
  (closing suggestion issues, filing drift).
- **Given** the committed dataset, **when** `build:data` runs, **then** it replaces only the
  curated tier and keeps every other record exactly, because `build:discovery` reads that file
  as the previous dataset to preserve enrichment from.
- **Given** a curated record, **then** each field is decided by its owner (`OWNER` in
  `scripts/build-data.ts`, a record over every key of `Trek`, so a new field does not compile
  until it is classified):
  - **`run`** fields come from this run alone: the seed, then this run's enrichers. That covers
    what the seed may state (including `highlights`, `elevationM` and `permitRequired`, which an
    enricher may also fill), `bestSeason` (the seed's, else derived this run from the committed
    rainfall grid, as `build:climate` does), the road distance and drive time (facts about the
    route from the origin, not the summit), and the discovery-only signals `discoveryScore` and
    `estimatedDifficulty`. One removed from the seed, or not produced this run, is gone. A
    route-service hiccup would therefore drop road distances; the drift guard refuses a
    refresh with **any** more curated records lacking a road distance or drive time than the
    committed file (`missingRouteFacts`), since there are only 16 and a tolerance would let
    five go.
  - **`place`** fields (terrain, land cover, gazetteer, hill features, trail, POIs, gallery)
    keep their previous value when this run produced none, **while the seed is within 120 m of
    where it was** (`CARRYOVER_KM`, `scripts/lib/carryover.ts`, the distance discovery uses for a
    rescanned summit).
  - **`sources`** (the photo) is kept on the same condition, only while the seed cites the
    same sources, **and only when this run's lookup could not say** (CON-DATA-002). A failed
    fetch, or a title that is now a disambiguation page, is unknown, so the photo stays. An
    article that answered with no usable photo (removed, relicensed) has none, and it is
    dropped; so is one from a different article.
- **Given** a new seed with the id of an existing discovery pin, **then** the curated record
  replaces the pin, taking what was baked for that place, rather than duplicating the id.
- **Given** a curated record, **then** its keys keep their previous order, so a refresh that
  changed nothing rewrites nothing.
- **Given** a Wikipedia title that is now a disambiguation page, **when** the build reads it,
  **then** it takes nothing from it and says so (`disambiguation: true`), which the fold reads
  as "unknown", not "no photo".
- **Given** a committed `treks.json` that is not JSON, not an array, or has an entry that is
  not an object with an id, **then** `build:data` refuses it naming the file, before the fold.

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
  guard did not count. The fold now keeps them, and the guard counts curated photos
  (`curatedImage`) so a bulk loss is caught (it tolerates up to 5 records, like every field).
  Only curated ones: `build:discovery` re-fetches the other 181 photos best-effort every run,
  and that churn would turn the guard red weekly for no outage.

## Test cases (TDD checklist)

- Pipeline runs headless (mocked or live-allowed) in CI and produces a valid file.
- "Commit only if changed": given identical output, no commit is made (script/unit test of the
  diff gate).
- A forced validation failure causes a non-zero exit before any commit.
- `scripts/build-data.test.ts` → `foldCurated`: non-curated records kept exactly; `place` fields
  carried; nothing carried across a corrected position; the photo dropped when the cited article
  changes or answered with none; a `run` field (`permitRequired`) dropped when no longer given;
  key order kept; a removed seed dropped. `runBuildData`: the written file keeps every discovery
  record; a photo is dropped when the article answered with none and kept when the fetch failed
  or the title is a disambiguation page; a non-JSON file, a non-array and a `null` or id-less
  entry are each refused by name.
- `scripts/sources/parsers.test.ts`: a disambiguation page yields nothing but the flag.
- `scripts/build-tools.test.ts`: the drift guard counts curated photos only, fails on a bulk
  curated photo loss, and `missingRouteFacts` counts a curated record lacking either route
  fact.
- `scripts/report-failure.test.ts` (fake `gh`): opens an issue when none matches, comments on
  the exact-title match, ignores a title that merely contains the words, closes the issue on a
  later success, does nothing on success with none open or for a cancelled or skipped run,
  reads every open issue through the paginated REST list (not the lagging search index),
  ignores a pull request with the same title, closes every duplicate on success, refuses no
  title.
- `scripts/build-data.test.ts` also: a best season deleted from the seed is gone; a seed with
  none gets the rainfall-derived one this run, and the live enricher reads the committed grid; a
  promoted pin replaces the discovery record without its discovery score or estimated
  difficulty; a road distance this run did not measure is not carried; key order holds even
  when the built record's keys come in a different order; a committed file that is not an
  array is refused by name.
- `scripts/report-failure.test.ts` also: a cancelled run is filed; the message says only "failed"; a missing result is
  refused with nothing posted; the four callers report only on `main`; the test names `jq` when
  it is missing.
- After merge: dispatch the refresh and read back a green run (CON-VER-003).

## Out of scope

- **One file per writer.** `build:data` and `build:discovery` both write the whole `treks.json`,
  which is why the fold and the ownership table exist. Committing the curated tier as its own
  file, composed by discovery and chunking, would remove the read-modify-write. It touches the
  app's loader, chunking and every hand-run tool, so it is its own change; until then, the fold
  and the drift guard keep the shared file safe.

- Deploy mechanics (→ 09). Curating new cities (a manual/dispatch pipeline run).

## Open questions

- ~~Failure alerts: rely on GitHub's default failed-run email?~~ Answered by the incident above:
  no. A failed run files an issue.
- Cadence confirmed weekly — bump to daily only if data proves to change faster.

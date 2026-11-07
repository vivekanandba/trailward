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
  runs `build:data`, validates the output, and **commits only if the data changed**: `treks.json`
  or what is derived from it (chunks, the slug registry).
- **Given** main moved while the run built its data (a refresh takes hours), **when** it lands
  (`scripts/push-data.sh <sources> -- <derived>`), **then** only this run's change to the source
  data (`treks.json`, and the detected-name files for apply-suggestions) is carried onto the new
  main, as a three-way patch; the derived files (chunks, the slug registry) are main's and are
  rebuilt there by `npm run derive:data`, then checked (`check:refresh` for the refresh,
  `validate:data` for names). Those are npm scripts, so a step merged mid-run is run. A run that
  changed only derived files carries nothing and is simply rebuilt. A source change that does not
  apply, or a failed recheck, pushes nothing and fails the run, which the reporter files. A push
  a rule refuses (protection, a ruleset, permissions, a hook) is reported as such and not retried;
  any other failed push is retried from a fresh fetch. Each attempt, and the last look before
  giving up, first asks whether this run's commit is already on the branch (an ancestor of its
  tip, so it still counts after someone pushed on top): a push that reached the server but
  reported failure is counted as landed, and the deploy is still dispatched. The two workflows that write `treks.json` share one
  `concurrency` group. Incident, 2026-11-07: the first refresh to pass every check in twelve weeks
  lost its data to a rejected push, and a bare rebase would have landed it unchecked on a main
  that had since gained the slug registry (247 pages with no URL).
- **Given** the run landed its commit, **then** it dispatches the deploy: a push made with the
  workflow's own token starts no other workflow, so the data would otherwise sit on main
  unpublished until a person pushed.
- **Given** the data landed on `main`, **then** the dispatched deploy workflow (09) builds and
  publishes it; the bot's push alone would start nothing.
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
    refresh in which **any** record curated before and after lacks a road distance, drive time
    or photo it had (`curatedLosses`, per record and per field, no tolerance: there are only 16,
    and a count would let one record's gain hide another's loss). A new seed or a pin promoted
    this run is not a loss; one whose route failed ships without it. Nor is a photo the fold
    dropped by its own rule (the seed moved, or cites other sources: `photoCarries`, shared by
    the fold and the guard so they cannot disagree).
  - **`place`** fields (terrain, land cover, gazetteer, hill features, trail, POIs, gallery)
    keep their previous value when this run produced none, **while the seed is within 120 m of
    where it was** (`CARRYOVER_KM`, `scripts/lib/carryover.ts`, the distance discovery uses for a
    rescanned summit).
  - **`sources`** (the photo) is kept on the same condition **and** only while the seed cites
    the same sources. A lookup that came back without one is not evidence the photo is gone:
    a source that changed shape answers without a photo too, and that is how six were lost.
    So a photo its article dropped stays until a curator changes the seed's sources; a dead
    image URL is the weekly link check's to find (and that check now files an issue).
- **Given** a new seed with the id of an existing discovery pin, **then** the curated record
  replaces the pin, taking what was baked for that place, rather than duplicating the id.
- **Given** a curated record, **then** its keys keep their previous order, so a refresh that
  changed nothing rewrites nothing.
- **Given** a Wikipedia title that is now a disambiguation page, **when** the build reads it,
  **then** it takes nothing from it.
- **Given** a committed `treks.json` that is not JSON, not an array, has an entry that is not an
  object with an id, or has an invalid record the fold keeps exactly (`keptByFold`, the one rule
  the fold itself uses: any non-curated record no seed rebuilds), **then** `build:data` refuses
  it naming the file and the entry's index, before any network enrichment. A curated record is
  never kept exactly (it is rebuilt or dropped), so it is not refused there: the fold replaces a
  rebuilt record's `run` fields, which is how `build:data` repairs one a tightened rule rejects.
  Its carried place fields and photo are not rebuilt, and nor are those a promoted pin hands
  over, so one of those that fails is refused by the full validation of the folded output before
  the write, after enrichment, which names the record. A duplicate id is refused early.

- **Given** a refresh would take down a published page whose record is still in the dataset (a
  best-effort lookup missed its photo or text this week), **then** the drift guard refuses it
  (`carriedLosses`, in the weekly refresh only: any non-curated record that kept its id but lost
  a field discovery carries, `DISCOVERY_CARRIED` (photo, gallery, text, history note, nearest
  town, land cover and the rest), per record, which is the cause; the hand-run rebakes of spec 32
  clear some of those on purpose and keep the count tolerance; and `pagesLost`: a page that earned its place by its own photo, text or note and lost it; a page
  held only by its rank in its 1° cell may change hands week to week and is not counted), photo
  and text counts are held to the drift tolerance, and discovery carries a photo, gallery, text and nearest town over when a lookup
  misses (`DISCOVERY_CARRIED`, `scripts/lib/carryover.ts`). Incident, 2026-11-07: the first refresh to land in twelve weeks
  dropped 21 photos, 16 published pages that rested on them (Kumara Parvatha among them), and a
  17th pushed out of its cell's top three by a neighbour that had lost its photo. The deploy's
  own 404 test caught it, so nothing shipped; the data commit was reverted.

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
  filesystem; `foldCurated(built, existing)` is its pure fold, and `keptByFold(t, rebuiltIds)`
  the fold's rule for a record it keeps exactly, which `runBuildData` also checks early.

## Edge cases & error states

- No changes this week → no commit, no redeploy (logged "No data changes").
- Validation fails after build → job fails **before** committing; last good data stays live.
- Source outage → pipeline skips optional fields (per 02); only a structural failure blocks.
- Avoid infinite loops: landing data dispatches the deploy, not another refresh.

- **Incident, 2026-08-10 → 2026-10-26: every weekly run failed and nobody saw it.** `build:data`
  wrote `treks.json` with only the 16 curated records, so `build:discovery` preserved enrichment
  from a file that no longer held any (bestSeason 120,187 → 16, landCover → 0). The drift guard
  refused all twelve runs, which is why nothing broken shipped. But a red scheduled run emails only
  whoever last edited the cron, so the data simply stopped refreshing. Hence the fold, and the
  issue on failure. The same rerun also showed six curated photos vanishing because their
  Wikipedia lookups stopped returning one (Nandi Hills became a disambiguation page), which the
  guard did not count. The fold now keeps them, and the guard refuses any curated photo lost.
  Only curated ones: `build:discovery` re-fetches the other 181 photos best-effort every run,
  and that churn would turn the guard red weekly for no outage.

## Test cases (TDD checklist)

- Pipeline runs headless (mocked or live-allowed) in CI and produces a valid file.
- "Commit only if changed": given identical output, no commit is made (script/unit test of the
  diff gate).
- A forced validation failure causes a non-zero exit before any commit.
- `scripts/build-data.test.ts` → `foldCurated`: non-curated records kept exactly; `place` fields
  carried; nothing carried across a corrected position; the photo dropped when the cited article
  changes, and kept when the lookup answered without one or failed; a `run` field
  (`permitRequired`) dropped when no longer given;
  key order kept; a removed seed dropped. `runBuildData`: the written file keeps every discovery
  record; a non-JSON file, a non-array, a `null` or id-less entry and an invalid kept record are
  each refused by name and index before any enricher runs, while an invalid record the fold drops
  (a removed seed's) or replaces (a promoted pin's rebuilt field) is not; a duplicate id is
  refused early, by both indexes; a rebuilt curated record whose `run` field the validator
  rejects is repaired; one whose carried photo fails is refused by the output validation, naming
  it, and nothing is written.
- `scripts/sources/parsers.test.ts`: a disambiguation page yields nothing.
- `scripts/build-tools.test.ts`: `curatedLosses` names each route fact or photo a curated record
  lost, per record and field: a record routed this run does not hide another's loss, one already
  short a fact is caught losing the other, and a never-held field, a new record, a promoted pin,
  a demoted record and a photo dropped because the seed moved or changed sources are not losses;
  discovery photos are not counted.
- `scripts/report-failure.test.ts` (fake `gh`): opens an issue when none matches, comments on
  the exact-title match, ignores a title that merely contains the words, closes the issue on a
  later success, does nothing on success with none open or for a skipped run, files a cancelled
  run saying it was cancelled (not "failed"),
  reads every open issue through the paginated REST list (not the lagging search index),
  ignores a pull request with the same title and an issue a person filed with it (only a bot's,
  `user.type == "Bot"`, is its own: an outside account cannot be one and an edit cannot remove
  it), closes every duplicate on success, refuses no title.
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

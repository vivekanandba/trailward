# 32 — Data operations runbook

## Purpose

The dataset is produced by a dozen hand-run build tools plus two crons, and every incident this
project has had came from _operating_ them, not from app code. This spec records the operating
rules that previously lived only in session memory, so a rebake run by anyone (or any future
session) is safe by default.

## The one hard rule: treks.json writers run SERIALIZED

`build:discovery`, `build:climate`, `build:landcover`, `build:names`, `build:gazetteer`,
`build:hillfeatures`, `apply:names`, and `migrate` all read-modify-write `src/data/treks.json`.
Two running at once is a lost update: whichever finishes first has its fields destroyed by the
second's write. This happened (climate vs landcover) and cost a full repair cycle. There is no
lock file by design — the tools are hand-run; the rule is procedural: **one writer at a time,
always**. Snapshot-only tools (`build:geonames`, `build:detect`, `build:extra`) write their own
committed files and may run alongside anything.

## Full-rebake order (after a detection rescan or new source)

1. `build:detect` / `build:extra` / `build:geonames` — regenerate committed snapshots (parallel OK).
2. `build:names` — infer names INTO `india-detected.json` (before the bake, so pins bake named).
3. `build:discovery` — the merge: curated → OSM islands → listed (GeoNames+extra) → detected,
   occupancy-deduped, enrichment preserved by id then by coordinate (spec 27/31).
4. `build:landcover`, then `build:climate` — refill enrichment on new pins (serialized!).
5. `npx tsx scripts/check-enrichment-drift.ts` — prove nothing regressed (spec 31).
6. `build:chunks` + `validate:data` — regenerate served cells, validate.
7. Full gate (`quality:check`, coverage, e2e), then ship via the PR loop.

## Post-rebake acceptance: diff the field counts

A bake can exit 0 with thousands of fields silently gone (the WorldCover poisoning incident).
The drift guard mechanises this, but the habit stands: after ANY rebake, compare `records`,
non-Unnamed `name`, `bestSeason`, `landCover` counts against the previous treks.json before
shipping. Growth or parity is expected; any unexplained drop is a stop-the-line bug.

## Caches and their lifecycle

- `scripts/.cache/demtiles12/` — z12 Terrarium tiles (~3.4 GB, ~127k files after an all-India
  scan). Keep it: rescans and scoring reuse it; deleting costs hours of refetch. It is
  git-ignored and excluded from vite's file watcher (watching it exhausts inotify and kills the
  dev server — the ENOSPC incident).
- `scripts/geonames/.cache/IN.txt` — the GeoNames dump; the India mask and name inference need
  it. `build:geonames` fetches it.
- `src/data/climate.json` — committed, resumable cell store; re-runs fetch only missing cells.

## Cron interaction

The weekly `refresh-data.yml` (Mon 02:00 UTC) re-runs `build:discovery` + `build:chunks` from
committed snapshots and pushes to main. Two operational consequences:

- A data PR open across the cron window WILL conflict on generated files. Resolution: merge
  main, take the PR's versions of `src/data/*` + `public/data/*` when the PR's data is a
  regeneration (strict superset), and let the next cron fold in OSM freshness.
- The cron cannot damage enrichment: the drift guard fails the run instead of committing a
  regression, and preservation (id + coordinate) carries hand-baked fields.

## Known operational hazards (all bitten once)

- Detected `d12-` ids regenerate wholesale when scan parameters change (spec 27) — enrichment
  must be recomputable or coordinate-carried; never key anything durable on a detected id.
- Overpass returns HTTP 200 + `remark` for server-side timeouts (spec 31) — fetchers throw on
  it now; never "fix" that by parsing remarks as empty results.
- Background shell runs piped through `tail` buffer everything and mask exit codes — log build
  runs to a file and record `exit=$?` instead.

## Out of scope

App-code build/deploy (spec 09), the feedback pipeline (spec 29), and per-source details
(specs 16–31) — this spec is only the operating procedure across them.

## Verification

The rules that could be mechanised are: drift guard in CI (spec 31), watcher exclusions in
vite.config, writer tools' CLI guards (importing never executes), snapshot atomicity
(validate-before-write in every writer). The serialization rule and rebake order remain
procedural — this document is their enforcement.

# 42 — Live contracts, the delivery path, and journeys

## Purpose

Spec 41 covered the sources **offline**, against payloads we control. That proves our parsers
are right about a shape we asserted; it cannot notice when the shape changes. And nothing at
all covers the last step: whether the site people actually load is the site CI just built.

The constitution is blunt about this. CON-COV-001: application coverage says nothing about
whether software ships, and "after deploying, assert the running version equals the version
just built" is listed as a thing to do. Nothing in this repo does it today. Coverage is 81.7%
and the deploy is unverified — which is exactly the shape of the incident that rule records.

This spec closes four gaps: upstream drift, the delivery path, the crawl surface, and the
journeys a person actually makes.

## A. Live contract check — advisory, scheduled, and it opens an issue

Once a week, hit each real endpoint **once** and assert only the shape we depend on:

| Source               | Asserted                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Overpass             | a JSON body with an `elements` array (and **no** `remark`, which is how it reports failure at HTTP 200) |
| Open-Meteo archive   | `daily.precipitation_sum` present and numeric                                                           |
| Open-Meteo elevation | an `elevation` array of the length asked for                                                            |
| OpenTopoData         | `results[].elevation` — the failover must be alive, or the failover is fiction                          |
| Nominatim reverse    | an `address` object                                                                                     |
| Wikipedia GeoSearch  | `query.geosearch` array                                                                                 |
| Wikimedia Commons    | `query.geosearch` array for namespace 6                                                                 |
| Wikidata SPARQL      | `results.bindings` array                                                                                |
| Terrarium tiles      | a PNG magic number in the first bytes                                                                   |
| WorldCover COG       | a TIFF magic number in the first bytes                                                                  |

**It never blocks.** Upstream reorganising its API is not a reason to fail a build nobody
can fix by reverting. But a scheduled red run is easy to scroll past, so on drift it
**opens a GitHub issue** — the repo already routes feedback that way (spec 29). One issue,
reopened and updated rather than duplicated weekly, so a persistent outage is one thread.

The check asserts _shape_, never _values_: a summit's elevation changing is not drift, and a
test that asserts it would fail for the wrong reason forever.

## B. The delivery path — assert the deployed version

`npm run build` writes `dist/version.json` carrying the commit SHA and build time. After
`deploy-pages` reports success, a job fetches the **live** URL and asserts:

1. `/version.json` serves the SHA of the commit that just built. Not "a 200" — the value.
2. `/` returns 200 and carries the app shell.
3. `/sitemap.xml`, `/robots.txt` return 200 with the expected content type.
4. A sample trek page (`/t/skandagiri/`) returns 200 and carries its `<h1>`.
5. `/sources/` returns 200 — a content page, which the sitemap advertises.

Fetched with cache-busting and a **bounded retry**, because the CDN takes a moment to turn
over and almost every "wrong sha" seen in that window is really "not yet". Distinguishing the
two up front turned out to be impossible in practice: `workflow_dispatch` carries no previous
sha, and a run cancelled by the concurrency group leaves the live site older than the one it
would name. So any non-matching sha is retried to the budget and then fails. A malformed or
sha-less `version.json`, and a transport error, are retried on the same budget and likewise
fail — each reporting _its own_ reason, never a generic one.

**This job must be able to fail.** It is proven by pointing it at a SHA that was never
deployed and watching it exit non-zero.

## C. Screenshots — the states that were never captured

The 12 existing baselines cover the default views. Extend to the states a change is most
likely to break and a reviewer least likely to open by hand: the command palette open, a trek
page, `/about/` and `/sources/`, an empty result set, and the mobile sheet at its half snap.

Generated **in CI**, because a baseline produced anywhere else is not a gate — local font
rasterisation differs from the container's and the whole-page diff is red before anything is
wrong (spec 38).

## D. Journeys — what someone was trying to do

Assert the flow end to end rather than the click:

1. **Find a trek near a place**: search a city → results update → open a trek → its detail
   carries a directions link pointing at the trek's coordinates.
2. **Arrive from a search engine**: land on a static trek page → its link into the map opens
   that trek selected.
3. **Jump across the country**: ⌘K → type a summit in another state → land on it.
4. **Keyboard only**: tab from the top → the skip link reaches the results without a mouse.

A journey test asserts the user's goal was achievable, not that a particular button exists.

## E. The suite must be deterministic (CON-VER-008)

Load is normal, not exceptional: the local gate runs on a VM shared with every other project's
CI (this repo is public, so its own CI runs on GitHub-hosted runners, which are not idle either).

- **Wait for loading by state.** Waiting for the "Loading peaks" status to detach passed before
  React had rendered it at all, so tests raced the cell load and failed 1 run in 6 at a load
  average of 12–18 (2026-10-10). The result list now carries `aria-busy` while it loads, and its
  loading announcement sits outside it, because `aria-busy` holds back announcements within.
  `resultsLoaded()` (`e2e/helpers/deterministic.ts`) waits for `aria-busy="false"`, which exists
  only once the list has rendered and loading has ended. Its 50 s timeout, under the 60 s per-test limit (raised from Playwright's 30 s default after a first test paid for the dev server's cold compile at a load average of 13), bounds a hang; it does not assert speed.
- **The map is settled by state too.** A fixed 600 ms sleep before screenshots let a capture
  beat the cluster recompute under load. `mapSettled()` waits until every pin and cluster has
  kept its position for five reads in a row, 100 ms apart. A detail screenshot also waits for
  the stubbed photo's failed state (the image removed), which is what the baseline shows.
  `settledCount()` likewise reads a count until it is stable across three reads.
- **Clock waits that remain, named so they are not forgotten.** `visual.spec.ts` still sleeps
  before three screenshots: 400 ms for the mobile filters sheet, 300 ms before the palette and
  500 ms before the half-snap sheet. They passed every run on 2026-10-10 at load averages up to
  18, but they are the same class of wait as the 600 ms map sleep that did not. Each should
  become a state wait (a sheet's settled transform), and until then they are the first suspect
  for a visual failure that appears only under load.
- **Act only once the app is listening.** A journey pressed ⌘K straight after `goto`, before the
  effect that attaches the shortcut had run. The key was lost and the palette never opened, so
  no timeout could have saved it. Tests that drive the app by keyboard wait for
  `resultsLoaded()` first. Waits on lazy chunks get an explicit bound under the test timeout.
- Third-party tiles are stubbed. The static project runs in its own pass.
- **Every Playwright job runs on one pinned image, never `ubuntu-latest`.** On 2026-10-31
  `ubuntu-latest` had become 26.04, where Playwright 1.60 cannot install its browser
  dependencies: every PR's e2e jobs, the deploy's e2e gate and the baseline generator failed
  with no change in this repo. Every job of `ci.yml` and `deploy.yml` (four of them Playwright
  jobs, plus the site build that is deployed) and the baseline generator in
  `visual-baselines.yml` run on `ubuntu-24.04`. Each Playwright job installs browsers through one
  composite action, `.github/actions/playwright-setup`, which keys the browser cache on the OS
  release read from `/etc/os-release` in a step. On main the key was `playwright-${{ runner.os }}`,
  which is `Linux` on 22.04, 24.04 and 26.04 alike, so a move restored browsers built for another
  release; `env.ImageOS` cannot fix that, being empty in an expression, and `ImageVersion` moves
  weekly and would discard the cache. Moving image means regenerating the baselines there in the
  same PR.
  - **Known limit:** `ubuntu-24.04` is a label, and GitHub updates its image weekly. A font or
    freetype change there can still shift the baselines. The Playwright container
    (`mcr.microsoft.com/playwright:v<lockfile>-noble`) would pin that too. It is not used yet
    because every baseline would have to be re-rendered in it. Spec 33 measured a ~2% text
    diff between a local container and the runner (August 2026); on this VM, on 2026-10-31, the
    local suite passed against these CI-made baselines, so today local and CI agree within the
    1% tolerance. That is an observation, not a guarantee, and a container would remove the
    question. A baseline failure across every
    screenshot at once is the first sign the image moved.
- **The baselines lagged the app inside the tolerance.** They showed the shortcut hint as `⌘K`
  while Linux has rendered `Ctrl K` since spec 38, and the 1% pixel tolerance hid it until an
  unrelated text change pushed the same screenshot over. The baseline workflow could not have
  fixed it: `--update-snapshots` defaults to `changed`, rewriting only screenshots that fail, so
  it reported "Baselines already match" over the stale image. The workflow now passes `=all`,
  in the suite's two passes (app projects, then the static project, which starves the dev
  server when they share one). There is no local update command: one rewrote failing screenshots
  with the fleet VM's rendering, and a failing local run already leaves its actual and diff
  images in `test-results/`. Baselines come only from the workflow.
  Refreshing them after each intentional UI change is **review-enforced**: no check can tell an
  intended UI change from drift. `=all` may also commit antialiasing-only rewrites; that churn is
  the cost of never keeping a stale baseline.
- **CI runs the projects it says it runs.** The jobs called `npm run e2e -- --project=…`, but
  npm appends extra arguments only to the last command of a compound script, so the "app" job
  ran the app suite and then static mixed with the app projects in one pass, the starvation
  above, and the static job ran the whole app suite first (since spec 42's #75). They now call
  `npm run e2e:app` and `npm run e2e:static`. And Playwright starts every `webServer` it is
  given whatever `--project` asked for, so each app-only pass paid for a full production build;
  the config now starts only the servers the requested projects use
  (`scripts/lib/playwrightServers.ts`).
- **A flake fails the run.** CI retried a failed test twice and reported it green, so a flake
  was invisible. CI now retries once, so the failure leaves a trace, and `failOnFlakyTests`
  fails the run when a test passed only on retry (CON-VER-008).
- **An assertion's wait is a bound on a hang, not a speed check.** Every assertion polls for a
  state, but Playwright's default 5 s let "granted permission refreshes the origin" fail at a
  load average of 14 with the app not yet mounted (2026-10-31). The default bound is 15 s; the
  two waits on the lazy palette chunk, which had their own 10 s, are 20 s, so no explicit bound
  is tighter than the default. All are under the 60 s per-test limit.

## Edge cases & error states

- The live check runs in CI where a request may simply time out; a timeout is reported as
  "unverified", never as drift (CON-DATA-002 — unknown is not the same as no).
- The post-deploy check must not pass when `version.json` is absent: a missing file is a
  failure, not a skip.
- Journey tests must not depend on a specific record surviving a data refresh, beyond the
  curated seeds that are committed by hand.

## Test cases (TDD checklist)

- Each live probe's **parser** is unit-tested offline against a recorded body and against the
  drift it is meant to catch (Overpass `remark`, a truncated tile, an empty bindings array).
- The issue-filing logic: opens on first drift, updates rather than duplicates on the second,
  closes nothing by itself.
- `version.json` is emitted by the build and carries the SHA.
- The post-deploy assertion fails on a mismatched SHA, on a 404, and on a missing file.
- Journeys as above, on both desktop and mobile projects.

- `scripts/workflows.test.ts`: the five Playwright jobs named exactly; each on one literal
  `ubuntu-NN.NN` image, the same one, as is every job of `ci.yml` and `deploy.yml`; each sets up
  browsers only through the shared action, after its checkout; the action reads `/etc/os-release` in a
  step before every cache step and keys on its output, never `env.` or `ImageVersion`; the
  baseline generator rewrites with `=all` in two passes; no package script updates snapshots; no
  workflow runs `npm run e2e -- <flags>`; CI fails on a flaky test; the expect bound is at least
  15 s and no `timeout:` anywhere in e2e is tighter. Each assertion was mutated and failed.
- `scripts/lib/playwrightServers.test.ts`: both `--project` spellings; app projects start only
  the dev server, static only the preview, all or a mix start both.

## Out of scope

Blocking a deploy on upstream drift; testing third-party uptime; visual baselines for every
trek page (one sample is the contract, 3,886 is noise).

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

## Out of scope

Blocking a deploy on upstream drift; testing third-party uptime; visual baselines for every
trek page (one sample is the contract, 3,886 is noise).

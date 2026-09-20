# 41 — Seams for the network build tools, and the coverage floor they unlock

## Purpose

Spec 40 put the _artefact_ tools behind an I/O seam and raised the floors to what they
measured. It said plainly where that stopped: global coverage reached 74.9% against a 95%
target, and the whole remaining gap is the **network build tools** — the CLIs that call
Overpass, Open-Meteo, Wikidata, GeoNames and the WorldCover/Terrarium tile stores.

That is not an accident of effort. Those tools are untested because they are hard to test,
and they are hard to test for the same reason they are dangerous: each one reads the whole
dataset, talks to a third party that can fail in ways an HTTP status does not describe, and
**writes `src/data/treks.json` back over itself**. Both of this project's silent data losses
happened here — a transient header error cached `null` for a whole 3° tile and wiped
`landCover` from ~113k records, and a rescan regenerated every detected id so enrichment
keyed by id carried nothing forward.

This spec extends the spec-40 seam to those tools and states the floor it unlocks.

## A. The seam, extended for the network

Spec 40's `BuildIO` covers the filesystem. These tools also need the network injected, so
each exports:

```ts
export async function runBuildX(io: BuildIO, repoRoot: string, deps: XDeps): Promise<XResult>;
```

`XDeps` is a small record of the _network_ calls the tool makes — `fetchRain`, `classesAt`,
`sparql`, `overpass` — never an HTTP client. A test supplies plain functions; the CLI wrapper
supplies the real adapters from `scripts/sources/`. The tool's own logic (ordering, merging,
resume, the refuse-to-write rules) is then reachable without a network at all.

`repoRoot` is passed rather than each path, so the destructive write is derived and not the
caller's to name (CON-PROC-006, as spec 40 established).

## B. What every network build tool must be shown to do

The five contracts from spec 40 §B still apply. These tools add four more, each drawn from
something that has already gone wrong here:

6. **A partial fetch never becomes a mass deletion.** Spec 26 requires dropping a stale value
   rather than keeping a wrong one, so a single failed reading correctly clears that record's
   field. What must not happen is that clearing across the dataset. The WorldCover incident is
   exactly this shape — a transient header error cached `null` for a whole 3° COG, so every
   point read `undefined`, **no record was removed**, and ~113k silently lost `landCover`
   while the run reported success. A guard counting _removed records_ would have sat at zero
   throughout. So the bound is on records that LOSE a value they had, plus records dropped,
   as a fraction of those that had something to lose. This is the single most important
   property in this file.
7. **Resume is honest.** A tool that skips already-sampled work must skip it because the
   value is _present_, not because a previous run recorded an attempt. Re-running after a
   rate-limit window must make progress; re-running after a complete run must do nothing.
8. **The summary counts what changed**, separating baked from dropped from unchanged. A
   count that lumps them together is how a destructive run reads as a productive one.
9. **Enrichment is preserved across id changes.** Detected ids regenerate on a rescan
   (spec 27), so anything that carries values forward must key on location, not id, and a
   test must prove it survives a full id regeneration.

## C. Refusing, specifically

Each tool declares the condition under which it writes nothing and exits non-zero:

| Tool            | Refuses when                                                        |
| --------------- | ------------------------------------------------------------------- |
| build-climate   | no rainfall returned **and** no previously sampled cells exist      |
| build-landcover | the validated dataset would lose more than the drop tolerance       |
| build-names     | the name source returns zero rows for a sweep it believes complete  |
| build-detect    | the set is empty, or would replace the committed set with far fewer |
| build-gazetteer | zero entries parse from every volume it could read                  |
| build-geonames  | the dump parses to zero usable rows                                 |

Every one of these is asserted by a test that feeds the failing condition and checks **the
previous artefact still exists**, not merely that a throw happened — spec 40 round 3 found
refusals that fired after the destructive step, which is not a refusal.

## D. Floors — what this actually reached

Measured 2026-09-20 after this spec's work, reproduced across two consecutive
runs. Each floor sits just under its measured value so it can only ratchet up
(CON-COV-002).

| Scope                | Lines    | Branches | Floor set | Before   |
| -------------------- | -------- | -------- | --------- | -------- |
| `scripts/lib/**`     | 98.3     | 94.9     | 98 / 94   | 97 / 94  |
| `src/lib/**`         | 95.1     | 89.1     | 95 / 89   | 94 / 88  |
| `scripts/sources/**` | 91.6     | 88.0     | 91 / 87   | 76 / 86  |
| `src/components/**`  | 84.9     | 85.0     | 84 / 84   | 84 / 84  |
| `scripts/**`         | 76.9     | 89.4     | 76 / 89   | **none** |
| **Global**           | **81.7** | **88.3** | 81 / 87   | 74 / 86  |

`scripts/**` had no floor at all before, which is exactly how that directory sat
at 45% without anything noticing.

**Where this falls short, stated plainly.** Section D of the first draft of this
spec said global ≥90. It is **81.7**. That prediction was written before the
work and it was wrong; this table is the measurement, and the spec is corrected
rather than the number massaged.

Two things make up nearly all of what remains, and neither is excluded — both
are named here so the gap stays visible:

1. **The DEM-walking functions**: `detectIndia` and `score` in build-detect,
   `scoreSummits` and `crossMatchWikidata` in build-geonames. These walk ~126k
   Terrarium tiles or issue nationwide SPARQL box queries. They are now behind
   the seam — everything _around_ them is tested — but the functions themselves
   need recorded tile fixtures to execute, which is spec 42's work.
2. **The CLI blocks.** Every tool ends in `if (process.argv[1] && import.meta.url
=== pathToFileURL(process.argv[1]).href)`. That branch is false by
   construction under vitest, so those lines can never be covered in-process.
   The contract lives in `run(io, …)` and is fully covered; the wrapper is a
   wiring statement. This is the honest ceiling for a CLI, and it is the reason
   a 95% _global_ target is the wrong shape for this repo — the right target is
   95% for logic directories, which `src/lib` and `scripts/lib` now meet.

Each floor was proven to enforce by setting it to 100 and watching the build
exit non-zero. Branch coverage remains slightly unstable run to run
(88.27–88.33 observed), so those floors sit below the lowest figure seen and the
instability is named rather than averaged away.

## Edge cases & error states

- A tool whose CLI wrapper still does real I/O must not be importable without side effects —
  the `import.meta.url === argv[1]` guard stays.
- Injected network functions in tests must be able to _fail_: the retry, the 200-with-an-
  error-body and the empty-result paths are the point, not the happy path.
- A tool that writes `treks.json` must round-trip through `validateDataset` before writing,
  and the test proves it by feeding a record the validator rejects.

## Test cases (TDD checklist)

- `runBuildClimate`: resume skips sampled cells; refuses when nothing is returned and nothing
  exists; bakes `bestSeason` only where a season is derivable; curated guidance is never
  overwritten.
- `runBuildLandCover`: a sampling failure drops the stale value rather than writing a wrong
  one; a detected pin in open water is removed, a curated one is not; spatial ordering does
  not change the output.
- `runBuildNames`, `runBuildDetect`, `runBuildGazetteer`, `runBuildGeonames`: the refusal in
  §C, the summary in §B.8, and preservation across id regeneration where they carry values.
- Every refusal test asserts the previous artefact survived.

## Out of scope

Rewriting the sampling algorithms; changing what any tool produces. This spec is about being
able to prove what they already do. Live contract checks against the real endpoints are
spec 42.

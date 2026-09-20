# 40 — Testability of the build tools, and tiered coverage floors

## Purpose

This code is machine-written, so the burden of proof on it is higher, not lower. Coverage sits
at 68% because an entire class of code has never been executed by a test: the **build tools**.
Their pure helpers are tested; their `main()` shells — the part that actually reads the dataset,
calls the network, and writes the committed artefacts — are at 0%. Those shells are precisely
where a silent data loss lives (this project has had two).

This spec makes them testable, tests them, and then raises the floors to a tiered standard that
each directory can actually meet.

## A. The seam

Every build tool exports a `run(io)` function; `main()` becomes a thin CLI wrapper that supplies
the real I/O. The project already does this for fetchers (`fetchMonthlyRain(cells, getJson = …)`),
so this extends an existing pattern rather than inventing one.

```ts
export interface BuildIO {
  readFile(path: string): string;
  writeFile(path: string, body: string): void;
  exists(path: string): boolean;
  removeDir(path: string): void; // must refuse a path that resolves elsewhere
  listDir(path: string): string[]; // must THROW when the directory is absent
  log(line: string): void;
}
```

A test supplies an in-memory `BuildIO` and asserts the tool's **contract**, not its internals.

**The fake must not be kinder than the disk.** A `memoryIO` that is more
forgiving than `nodeIO` makes every test using it green for nothing — the
classic seam failure. Both implementations are therefore driven through one
shared table (`buildIO.test.ts`), which is also the only thing that executes
`nodeIO` at all. Three divergences were found this way and fixed: `exists` was
false for every directory (so `build-pages`' own `exists(distDir)` guard was
inexpressible through the seam), `listDir` returned duplicates, and `listDir`
returned `[]` for a missing directory instead of throwing — which is how a
build could exit 0 having written no `/about/` or `/sources/` while the sitemap
still advertised them.

## B. What every build tool must be shown to do

1. **Writes what it claims.** The count in its summary line equals the records it actually
   wrote — a summary that overstates is how a partial bake reads as a complete one.
2. **Validates before writing.** A tool that writes an invalid dataset has corrupted the repo;
   `validateDataset` must gate the write, and the test proves it by feeding an invalid record.
3. **Refuses to write on total source failure.** When every fetch fails, the tool must leave the
   previous artefact alone rather than replacing it with emptiness.
4. **Is resumable** where it claims to be: a second run with a populated sidecar does no work.
5. **Is byte-stable**: two runs over identical input produce identical bytes. These artefacts are
   committed, so instability shows up as noise in every diff and defeats review.

## C. Coverage floors — tiered, and honest about the ceiling

Measured 2026-09-20 with the default exclusions intact. Each floor is set just
under its measured value so it can only ratchet up (CON-COV-002), and every one
is **above what main enforced** — nothing here is a floor lowered to make a
build pass.

| Scope                      | Lines    | Branches | Floor set | main's floor |
| -------------------------- | -------- | -------- | --------- | ------------ |
| `src/lib/**`               | 94.9     | 89.0     | 94 / 88   | 92 / 85      |
| `scripts/lib/**`           | 98.1     | 94.7     | 97 / 94   | 80 / 88      |
| `src/components/**` (glob) | 84.9     | 85.0     | 84 / 84   | 58 / 78      |
| `scripts/sources/**`       | 76.8     | 86.8     | 76 / 86   | none         |
| **Global**                 | **74.8** | **87.2** | 74 / 86   | 68 / 72      |

`src/components` jumps because TrekMap is now excluded with a reason, not
because its tests improved.

Every figure above was reproduced across two consecutive runs before being
written down — an earlier draft recorded numbers that did not reproduce, which
is a fabricated measurement however small the drift (CON-DATA-001).

**Where this falls short, stated plainly.** The goal is 95% global. It is 74.8%.
The gap is concentrated in code this tranche did not reach: top-level `scripts/`
at 46% and `scripts/geonames/` at 43% — the network-heavy CLIs (`build-climate`,
`build-landcover`, `build-detect`, `build-gazetteer`, `build-names`). The same
`run(io)` seam applies to each and they are the next tranche. The floors above
make that a one-way ratchet in the meantime. Nothing was excluded to close the
gap on paper.

Note the per-directory table and the glob can disagree: `src/components/**`
also matches `src/components/ui/**` (75%), so the glob reads lower than the
directory row. The floor follows the glob, because that is what enforces.

**How the first measurement was wrong.** The numbers in the first draft of this
spec (global 84.97) were taken while the _test files themselves_ were being
counted as covered source. Vitest **replaces** `coverage.exclude` rather than
merging it, so setting that array dropped the default `**/*.test.ts` exclusion;
test files are ~100% covered by construction, which inflated every directory by
roughly ten points. Proving a floor enforces cannot catch this — setting a
threshold to 100 only shows the glob matches _something_. `coverageConfig.test.ts`
is the gate that catches it now (CON-PROC-003).

**Exclusions, each with its reason** — the constitution permits an exclusion only with one:

- `src/components/TrekMap.tsx` — ~700 lines of Leaflet. It cannot execute in jsdom (no layout
  engine), and is covered instead by the e2e suite and 12 visual baselines. Testing it in
  jsdom would mean mocking Leaflet entirely, which proves the mock works, not the map.
- `src/main.tsx` — three lines of bootstrap.

Nothing else is excluded. Where a number is short of the target, the spec says so rather than
widening the list, and the floor sits at the measured value so it can only ratchet up.

Each floor is **proven to enforce** by temporarily setting it to 100 and watching the build
fail: a glob threshold whose pattern misses nothing silently does nothing, and an unenforced
floor reads as protection while providing none.

## Edge cases & error states

- A tool whose `main()` still does real I/O must not be importable without side effects — the
  existing `import.meta.url === argv[1]` guard stays.
- Byte-stability is asserted on the artefact, not the log, because timestamps legitimately
  differ.
- Coverage of a file that exists only to be a CLI entry point (`main()` calling `run`) is
  allowed to be short; the contract lives in `run`.

## Test cases (TDD checklist)

- `run(io)` for each of: chunk-data, build-sitemap, build-search-index, build-pages,
  validate-data — each asserting the five contracts in section B that apply to it.
  **build-landcover and check-links are NOT done** — both still have a real-I/O `main()`, and
  `check-links.test.ts` covers two pure helpers (`collectUrls`, `sampleByHost`) rather than a
  seam. They belong to the next tranche with the other network CLIs; this list said otherwise
  in the first draft, which would have left the spec overstating its own evidence.
- `buildIO.test.ts`: both implementations through one conformance table, plus `nodeIO.removeDir`
  refusing a symlinked target and a symlinked parent.
- `coverageConfig.test.ts`: the default exclusions are still in place, so test files can never
  again be counted as covered source.
- `contentPage.ts`: page shell renders title/canonical/OG, `datasetStats` counts from a fixture,
  `dataPageMarkdown` reports those counts.
- Floors: each proven to enforce, as above.

## Out of scope

Rewriting the tools' algorithms; testing Leaflet; mutation testing (a reasonable next step once
the floors hold).

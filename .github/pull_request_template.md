## What & why

<!-- One paragraph: the behaviour change and the reason. -->

## Spec

<!-- Every behaviour change links its spec (created or updated in THIS PR).
     Refactors / test-only / generated-data refreshes: say so instead. -->

- Spec: `specs/NN-….md` — <!-- new | updated | n/a (reason) -->

## Checklist

- [ ] Spec created/updated in this PR (or exempt: refactor / tests-only / data refresh)
- [ ] Every behaviour in the spec's Verification section has a test in this PR
- [ ] Network fetchers follow the error-path contract (spec 31) — transient retries,
      loud/bounded persistent failure, no 200-shaped errors, sweeps prove completeness
- [ ] Data changes: enrichment field counts diffed (drift guard / spec 32) — no unexplained drops
- [ ] Full gate green locally: `quality:check`, coverage, e2e, `validate:data`

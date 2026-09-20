# 2026-09-20 · Proposal: CON-COV-005 — a web app's end-to-end suite covers UI, UX _and_ API

**Status:** proposed, unfiled. Drafted in trailward; handed over rather than
opened as a PR (CON-PROC-007).

## The incidents

Both from trailward, both shipped before they were caught.

1. **Screenshot baselines generated locally failed in CI with a whole-page text
   diff.** Not a layout bug — font rasterisation differs between the authoring
   machine and the CI container, so every glyph edge differed. The baselines were
   worthless as a gate: they could only ever be red. Generating them _in the
   environment that verifies them_ is what made the gate meaningful.

2. **Overpass returns server-side failures as HTTP 200 with a `remark` field.** The
   fetcher checked `res.ok`, got `true`, parsed zero elements, and reported "no
   peaks in this cell." A bake ran to completion and produced nothing, and it looked
   like a correct answer about the terrain. The same class bit a second time with a
   different upstream. Only a test that asserts the _error shape_ — not the happy
   payload — catches this.

## Proposed rule

### CON-COV-005 · For a web app, end-to-end means UI, UX and API — not clicks

A passing e2e suite that only drives happy-path clicks leaves three holes, each of
which has already shipped a defect here:

- **API contract tests, offline and always run.** Every external source is exercised
  against _recorded real payloads_ committed as fixtures, including every error shape
  the contract admits: transient failure and retry, **200-with-an-error-body**, bot
  walls, malformed JSON, truncated binary. An upstream that fails politely is the
  dangerous one.
- **A scheduled live shape-check, advisory.** Hit each real endpoint once on a
  schedule and assert the shape still holds, so upstream drift surfaces as a warning
  rather than as an empty rebuild.
- **UI baselines generated in the environment that verifies them.** A baseline
  produced anywhere else is not a gate.
- **UX asserted as journeys, not as clicks.** The unit of assertion is the thing a
  user was trying to do end to end, including a keyboard-only traversal.

## Why it belongs in the constitution

This is CON-COV-001 ("application coverage says nothing about whether software
ships") applied to the specific delivery path of a web app, and CON-COV-003
(cover the boundary between components) applied to the boundary with a third party.
Every project in the fleet that talks to an external API can be lied to by a 200.

## Cost of adopting

Recording fixtures is a one-time cost per source and they must be refreshed when a
contract legitimately changes — the scheduled live check is what tells you when.

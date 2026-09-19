# 37 — Accessibility, and the gates that keep it

## Purpose

Trailward has never had an automated accessibility test. Spec 08 asked for keyboard operation
and AA contrast; specs 33 fixed focus semantics by hand; nothing checks any of it on a change.
This spec adds the missing gates, and the small a11y fixes they surface.

It also closes three gaps in the quality machinery that the sibling portfolio project had
solved and this one had not.

## A. Accessibility

- **Skip link.** A visually hidden "Skip to results" link, first in tab order, revealed on
  focus, targeting the results list. On a map app the alternative is tabbing through map
  controls forever.
- **Landmarks.** `<header>` carries `role="banner"` implicitly; the rail/sheet becomes a
  `<nav aria-label>`-free but labelled region; `<main>` already exists. Each is reachable.
- **Live result count.** Changing a filter changes the result count with no announcement
  today. The count becomes an `aria-live="polite"` region so a screen-reader user learns that
  their filter did something.
- **Automated audit — dependency-free by necessity and by fit.** The obvious choice is
  `jest-axe`; it is deliberately NOT used. This machine has no registry access, so a new
  dependency cannot enter `package-lock.json`, and `npm ci` in CI would fail on a package.json
  that names one. Instead `src/lib/a11yCheck.ts` implements the subset of rules that matter
  for this app and that jsdom can actually decide: accessible names on interactive elements,
  `alt` on images, one `h1` and no skipped heading levels, labelled form controls, required
  landmarks, and `aria-hidden` never swallowing a focusable element. It runs over the
  assembled app in the default state and with the detail panel open (overlays are where these
  bugs concentrate).
  **What it does not cover, stated plainly:** colour contrast (covered by the token test
  below), focus-visible styling and real focus order (covered by e2e), and everything else
  axe would catch. This is a floor, not a certificate. If registry access appears, adding
  `jest-axe` alongside is the obvious upgrade.
- **Contrast is computed, not assumed.** A test parses the palette tokens and asserts WCAG AA
  (≥4.5:1 for text, ≥3:1 for large text and UI) against both light and dark surfaces. The map
  palette is already AA by construction (spec 33); this stops it drifting.

## B. Gates

- **External link integrity** (`scripts/check-links.ts`). The dataset carries thousands of
  source URLs (Wikipedia, GeoNames, OSM, archive.org). They rot off-box, after merge, when
  somebody else's site changes — no other check can see that. Rules learned from the sibling
  project: classify bot-walled responses (403/429/999) as **unverified**, not failed, or the
  check cries wolf; compare without the fragment. It is **advisory**: a third party's outage
  must not block a merge, so it writes its result to the run summary where it is visible, and
  exits 0. It runs **weekly on a schedule**, because link rot is time-based, not PR-based —
  the gap the sibling project left open.
- **Per-directory coverage floors.** The global floor is diluted by data-heavy files; a new
  untested module in `src/lib` or `src/components` can land at 0% without moving it. Add
  directory floors alongside the global ones.
- **Spec discipline in CI.** `/ship` asks for a spec with every behaviour change, but that is
  honoured by the agent, not enforced. A CI step fails a PR that changes `src/lib/trek.ts`
  (the data contract) or adds a `scripts/build-*.ts` without touching `specs/`. A validator
  can check the specs that exist; only this can catch the one that is missing.

## Edge cases & error states

- The link checker must not fail CI on a network outage; it must still be _visible_ when it
  finds something (a silently passing advisory step is useless).
- axe in jsdom cannot see colour contrast or focus-visible styling — those are covered by the
  contrast test and the e2e/visual suites respectively. The spec records this honestly rather
  than implying axe covers everything.
- The skip link must not be visible in the default screenshot baselines.

## Test cases (TDD checklist)

- `classifyLink` returns ok / moved / unverified / failed for 200, 301, 403, 429, 999, 404,
  500 and a thrown network error; fragment-only differences are not "moved".
- `linkReport` summarises counts and exits 0 even with failures (advisory).
- axe: zero violations on the default app and with the detail panel open.
- Contrast: every text token ≥ 4.5:1 on its surface in both schemes; a deliberately bad pair
  fails the helper (proving the gate enforces).
- Skip link: present, first in tab order, hidden until focused, moves focus to the results.
- Result count is inside an `aria-live="polite"` region.

## Out of scope

Screen-reader-specific behaviour testing (VoiceOver/NVDA), WCAG AAA, axe in Playwright (unit
coverage is enough here), automated Lighthouse budgets.

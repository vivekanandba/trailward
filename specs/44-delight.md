# 44 — Delight: computed, earned, and never invented

## Purpose

Trailward is careful and honest, and it is silent about having a personality. A person who opens
one of its 120,441 peaks mostly gets a column of numbers: 194 records carry a photo, 34 a trail,
10 a history note. The facts are right, and the moment is blank.

This spec makes the app say more without saying anything untrue. It started from the portfolio
repository's delight work (its specs 0004 and 0011, PRs #73 and #81–#85). It keeps what that work
proved: write tests first, compute claims instead of typing them, enforce motion rules with a test
that reads the code, and set a kill criterion for anything large. It differs in two deliberate
ways:

- **It is a register, not a list of ideas.** Every surface below has a row that names what
  happens today (observed on 2026-10-03, not assumed), the change, the rule that governs it, and
  the condition under which it gets deleted. A reviewer can disagree with one row without
  re-arguing the whole spec.
- **It is bounded by five rules, not a ban list.** Portfolio is a résumé, so it had to read as
  restrained: one set-piece, 300 ms everywhere, "no confetti, ever". Trailward is a tool for going
  outside, and some joy suits it. Inside the five rules anything is allowed, including several
  set-pieces, motion longer than 300 ms when it carries information, playful copy, an earned
  celebration and haptics.

The frame is the usual delight grid. **Low delight** is functional but forgettable. **Surface
delight** is charm with nothing behind it. **Deep delight** is both: it pleases _because_ it
tells you something you wanted to know. This spec aims for the third, and accepts the second only
when the charm acknowledges something the person just did.

## The five rules

These are the hard limits. Every rule further down is a consequence of one of them.

- **D1 — Delight never invents a fact.** Every sentence, number or drawing comes from a field we
  hold or from arithmetic on fields we hold: sun position, distance, month indexing. When an input
  is missing, its clause is **omitted, not filled**. No "about", no plausible default, no "usually"
  (CON-DATA-001, CON-DATA-002). This is the rule most at risk here, because 120k sparse records
  make filling the silence tempting.
- **D2 — Every movement has a still version.** CSS motion is already cut globally under
  `prefers-reduced-motion` (`src/index.css`). JavaScript motion (Leaflet `flyTo`, count-ups,
  draws) reads the preference through **one** helper module, `src/lib/motion.ts`: a hook
  `usePrefersReducedMotion()` built on the existing `useMediaQuery`, and a plain
  `prefersReducedMotion()` for non-React code. Both report **false** when `matchMedia` is missing,
  unlike `useMediaQuery`'s desktop-friendly `true` default, so jsdom takes the animated branch
  and tests must opt into the still one. Today the query is written inline twice (`Sheet.tsx:40`,
  `TrekMap.tsx:116`). A contract test (R26) fails on the query string appearing anywhere else.
- **D3 — The map stays usable.** Nothing blocks a pan, steals focus or delays a tap. Motion over
  300 ms is allowed only when it carries information and stops the moment the person acts, and it
  must sit on the allow-list in R26 with this spec's rule beside it.
- **D4 — Everything visual has a text equivalent that says the same thing.** That includes
  drawings, compass arcs and celebrations. Keyboard focus is always visible.
- **D5 — It pays its weight.** A size budget gate exists (R5) before any delight ships. An
  addition that brings a dependency names its cost in the PR.

**Explicitly allowed** (portfolio forbade these): more than one set-piece, information-carrying
motion over 300 ms, playful copy, a short celebration of something the person did, and
`navigator.vibrate` on supporting devices (gated by D2).

**Explicitly out:** sound (people use this on trails and in shared rooms), autoplaying anything,
scroll-jacking, and motion that plays on page load without an action or a data arrival behind it.

## Register — the surfaces, as observed on 2026-10-03

| #   | Surface                            | Today (observed)                                                                                                                                                                                                                                                                                                                  | Kind                  | Rules   |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------- |
| 0   | Static pages' JSON-LD              | **3,815 of 3,886** pages put a `url` in their structured data that 404s live: `trekJsonLd` uses `trek.id` (`seo.ts:140`), the page uses the slug (`pages.ts:14`)                                                                                                                                                                  | **defect**            | R1      |
| 1   | Focus                              | `focus-visible` is styled only in `ui/Button.tsx`; seven places remove the outline (R2 names them)                                                                                                                                                                                                                                | absence               | R2      |
| 2   | Print                              | No `@media print` anywhere                                                                                                                                                                                                                                                                                                        | absence               | R3      |
| 3   | Social card                        | One global `icons/og.png` for every page                                                                                                                                                                                                                                                                                          | absence               | R4      |
| 4   | Size                               | No size budget. `dist/assets` is 764 KB today                                                                                                                                                                                                                                                                                     | absence               | R5      |
| 5   | Theme toggle                       | Hard icon swap                                                                                                                                                                                                                                                                                                                    | surface               | R6      |
| 6   | Sparse peak detail                 | Numbers only for nearly all 120k records                                                                                                                                                                                                                                                                                          | blank → deep          | R8–R12  |
| 7   | Origin change                      | The map jumps                                                                                                                                                                                                                                                                                                                     | surface → deep        | R13     |
| 8   | Region stats card                  | Accurate, reads like a dashboard                                                                                                                                                                                                                                                                                                  | voice                 | R14     |
| 9   | 404                                | `public/404.html` redirects to the app root and **drops the path**; a dead `/t/<slug>/` lands on the default map without a word                                                                                                                                                                                                   | blank moment          | R16–R17 |
| 10  | Empty result list                  | Advises "try widening the radius", with no control that does it                                                                                                                                                                                                                                                                   | blank moment          | R18     |
| 11  | Palette with no matches            | A status message only                                                                                                                                                                                                                                                                                                             | blank moment          | R19     |
| 12  | Unnamed peak                       | The label `Unnamed peak`; naming actions exist further down (specs 28/29)                                                                                                                                                                                                                                                         | blank moment          | R20     |
| 13  | Offline                            | Nothing says so                                                                                                                                                                                                                                                                                                                   | blank moment          | R21     |
| 14  | Console                            | Silent                                                                                                                                                                                                                                                                                                                            | small                 | R22     |
| 15  | Personal layer                     | None                                                                                                                                                                                                                                                                                                                              | **proposed, R23–R25** | R23–R25 |
| 16  | Distance from a non-default origin | **12 curated treks** show and filter by their road distance _from Bengaluru_ whatever the origin: from Mysuru, Skandagiri is listed at 67.6 km when it is 176 km away (`filters.ts:37`, `TrekMap.tsx:193`, `TrekDetail.tsx:268` prefer `trek.distanceKm`). Reproduced through the app's own cell selection and filter, 2026-10-03 | **defect, own PR**    | —       |

## Rules

Figures inside quoted copy below ("06:09", "140 km", "412 mm") show the **shape** of a
sentence. They are not data, and no test or fixture may use them as expected values.

### A. The defect first

- **R1.** A static trek page's JSON-LD `url` equals its canonical URL. `trekJsonLd` takes the
  page's URL instead of deriving one from the id, so the two cannot disagree. A test over every
  built page asserts equality, and `check-deploy` asserts it on its sample page against the live
  site. It ships alone and first, because otherwise R16's new 404 is where those 3,815 search
  results land.

### B. Absences that read as carelessness

- **R2.** Every focusable element shows a visible `:focus-visible` ring. One global rule covers
  them all, and no component removes it. Today seven places remove the outline:
  `CommandPalette.tsx:109` and `:125`, `FilterBar.tsx:146`, `OriginSearch.tsx:117`,
  `App.tsx:619`, `TrekList.tsx:35` and `Sheet.tsx:177`. Each becomes `focus:outline-none` **plus**
  a `focus-visible:` ring, or loses the override. Containers focused only programmatically, such
  as `#results`, may keep no ring because they are never reached by Tab. Each exemption is named
  in R26's test.
- **R3.** Printing a trek produces a **trail card**, not a screenshot. That applies both to the
  static page (`/t/<slug>/`) and to the in-app detail. The card carries: the name; coordinates in
  decimal **and** degrees-minutes-seconds; elevation; season; nearest town; the directions URL
  written out in full; and the date it was printed. It leaves out map tiles, navigation, buttons
  and the sheet chrome, prints ink on white whatever the screen theme, and splits no fact table
  across a page. The point is a paper backup for a trailhead with no signal.
- **R4.** Each static trek page gets its own social card, generated at build from the record:
  name, elevation, nearest town (omitted when the record has none — records carry no region,
  spec 30), and the trek's mark on a relief-tinted panel. All text is drawn from
  bundled glyphs; Devanagari and diacritics must render, or the card falls back to the global
  one. The total stays inside R5's budget. If 3,886 cards do not fit, the measured number goes
  in the Revisions table along with the subset that gets cards (curated first, then by
  `discoveryScore`).
- **R5.** `npm run check:size` fails the build when the shipped JS+CSS (`dist/assets`) exceeds its
  budget, or when `dist/` exceeds its own. A budget is a ceiling, so it ratchets **down**: after a
  reduction it is tightened to just above the new figure. It is raised only in a reviewed change
  that states the cause and the new figure. R4's social cards are such a cause, and their PR
  carries the raise and the measurement.
- **R6.** The theme toggle's new icon rotates in when pressed. The animation is keyed to the
  press count so it never plays on load, and it is still under D2.
- **R7.** Nothing animates on page load unless data is arriving. Every movement in this spec
  answers either an action (a press, a tick, a search) or an arrival (cells loading), and
  closing anything is instant.

### C. Things only trailward can say (the set-pieces)

Each set-piece works for every record that has its inputs, rather than for the 194 with photos.
Each has a **kill criterion**: if it does not read correctly within two seconds on a 360 px phone,
it is deleted, not tuned. Each gets a screenshot at 360/768/1280 in both themes _before_ it is
wired in.

- **R8. Sunrise and sunset.** The sun's rise and set times and azimuths come from the NOAA
  solar-position algorithm, using `lat`/`lng` and the **standard** sunrise definition (the sun's
  upper limb at −0.833°, a sea-level horizon). No network and no key. The detail shows the **next**
  sunrise (today's if it is still ahead, else tomorrow's), e.g. "Next sunrise 06:09, in the
  east-south-east (104°)", plus a small compass arc of the sun's path. The copy calls it the
  standard sunrise for this spot. Height is **not** corrected for: a summit's real horizon is a
  plateau or a ridge, not sea level, and a dip computed from `elevationM` would add precision we
  do not have (D1). Times are shown in IST. This is valid because the dataset's measured extent is
  6.8–36.0° N, 68.2–97.4° E (2026-10-03); a record outside India changes this rule and gets a
  Revisions row.
- **R9.** The sun computation is a pure module, `src/lib/sun.ts`. It is unit-tested against NOAA
  calculator output, fetched and recorded in the fixture with its source, for at least three
  Indian latitudes (8°, 20° and 34° N) at both solstices and one equinox, within ±2 minutes and
  ±2°. Both sides use the same standard definition, so the tolerance is meaningful.
- **R10. "Is now a good time?"** The existing rainfall strip (`TrekDetail.tsx:129`) marks the
  current month, and the detail opens the section with a computed sentence:
  - "October is in this peak's dry window", from `driestMonths`.
  - "This is the wettest month here (Jul, 412 mm)", from `wettestMonth`.
  - Otherwise, the month's mean rainfall and the next dry month.

  The month comes from the device clock. It covers the 120,187 records with a climate cell, and
  says nothing for the rest (D1).

- **R11.** The rainfall sentence is built by a pure function, `seasonSentence(monthly, month)`,
  whose output is tested for every month and for a record without climate data, where it returns
  nothing.
- **R12.** Neither R8 nor R10 claims trail conditions, safety or crowds. They describe sun and
  rain averages, and their copy says so.
- **R13. The search arrives.** When the origin changes, the map flies to it (Leaflet `flyTo`), and
  the radius ring draws outward from the origin. Pins fade in as their cells load, so the motion is
  the loading state rather than ornament on top of it. Any pan, zoom or tap during the flight
  stops it where the person left it (D3). Under D2 it cuts straight to the result. Both branches
  are tested end to end. The default e2e context emulates reduced motion (`playwright.config.ts`),
  so R13 adds a test in a `reducedMotion: "no-preference"` context. That test starts a flight,
  pans mid-flight, and asserts the map ends where the pan left it, not at the origin. Tests
  assert endpoints only, never a frame in between (CON-VER-008).
- **R14. The region speaks.** The stats card leads with one computed sentence:
  "&lt;n&gt; peaks within &lt;r&gt; km of &lt;origin&gt;. The highest is &lt;name&gt; at
  &lt;m&gt; m, and &lt;k&gt; are hidden gems." Each clause appears only when its number exists
  and is non-zero, and every count agrees in number ("1 peak", "1 is a hidden gem"). A pure
  `regionSentence(stats, origin, radius)` builds it.
- **R15.** Every sentence builder in this spec — `regionSentence`, `seasonSentence`,
  `sunSentence`, `emptySuggestion` — is tested over generated sparse records, with every optional
  field removed in turn and every count at 0, 1 and many. No output may contain `undefined`,
  `NaN`, `null`, an empty clause, a dangling "and", "about", or a plural on a count of 1. This is
  D1 turned into a test.

### D. The blank moments get a voice and an action

- **R16. A 404 that helps.** For a path shaped like `/t/<slug>/`, the 404 page matches the slug
  against a **pages index** generated at build: `data/pages-index.json`, one `[slug, name, id]`
  per static page, measured and budgeted under R5. The 2 MB palette index is not used, because a
  dead page link is most likely a renamed page, and 2 MB per 404 fails D5. On a confident match
  it says "Did you mean &lt;name&gt;?" and links to that page, which exists by construction
  because the index lists only built pages. Otherwise it says, in the app's voice, that this trail
  has gone cold, and offers the palette's search in the app (`/trailward/`) and the map.
  "Confident" is defined in the pure matcher `src/lib/notFound.ts` and tested, including its
  refusals: a weak match, or two equally good ones, must **not** be offered as a correction.
- **R17.** Every other unknown path keeps today's behaviour: redirect to the app root, keeping
  the query string and hash, so shared URL state still resolves (`urlState.ts`). `vite preview`
  serves `index.html` for unknown paths and never `404.html`, so it cannot exercise this. The e2e
  therefore reproduces GitHub Pages' behaviour itself: a Playwright route answers an unknown
  `/trailward/t/<slug>/` with `dist/404.html` and status 404 **at the original URL**, so the page
  sees the real pathname. A second test checks that a non-`/t/` path still redirects with its
  query and hash. Both assert content, never status alone (spec 42's soft-404 lesson).
- **R18. The empty list acts.** When no record falls within the radius **and filters are at
  their defaults**, the list offers one button: "Widen to 150 km to reach the nearest peaks." It
  states **no distance to a peak**, because what is computed is a cell's corner, not a peak (D1).
  The radius is the straight-line distance to the far corner of the nearest non-empty cell in
  the cell index, rounded up to the slider's 5 km step. Because it is the far corner, every
  record in that cell lies inside the suggested radius **as straight-line distance**. That
  guarantee depends on the filter measuring straight-line distance, so it holds only once the
  road-distance defect (register row 16) is fixed. A unit test drives `applyFilters` itself, not the geometry alone: whenever the suggestion is
  not capped, filtering that cell's records at the suggested radius yields at least one result. Further rules:
  - When filters are active, the existing "Clear filters" remains the action.
  - When the far corner lies beyond the 500 km maximum but part of the cell lies within it, the
    button offers "Try the maximum, 500 km", without a promise.
  - When no non-empty cell comes within 500 km at all, the copy says so and there is no button.
  - If widening still yields nothing (a stale index), the copy says so; it never loops.
- **R19.** When the palette finds nothing, it offers up to three summits whose folded names are
  nearest the query, as buttons that select them. Each suggestion is asserted to exist in the
  index.
- **R20.** An unnamed peak's detail opens with an invitation, not an apology: "No map we can read
  names this peak. If you know it, name it." That line links to the existing naming flow (specs
  28/29), and the record's computed facts follow.
- **R21.** When `navigator.onLine` turns false, a quiet chip says what still works: the treks
  already loaded and their details. It says the map's background may be blank, because basemap
  tiles are cross-origin and the service worker does not store them (spec 43). When the connection
  returns, the chip leaves without a fuss. It promises nothing the cache cannot do.
- **R22.** The production app writes exactly one thing to the console: a greeting that names the
  repository and the data sources, inside a `try`. The assertion runs in the **static** project
  against the production build, where no dev-server or React DevTools messages exist. It
  collects every console message on load and requires exactly the greeting, with no ignore-list.

### E. The personal layer — **proposed, not approved**

R23–R25 add state. That makes them a feature, not polish, so they ship only after the owner says
yes. Until then they are recorded here so they are argued about once.

- **R23. Been there.** Any peak can be ticked as climbed. The tick is stored in `localStorage`
  only: no account and no server, in keeping with the no-backend constraint. Every read and write
  is wrapped so that with storage unavailable the app behaves exactly as today.
- **R24.** A "Your peaks" filter, and a computed line, "You have climbed 7 of the 412 peaks within
  100 km of &lt;origin&gt;", subject to D1.
- **R25.** Ticking a peak plays one earned celebration: a 600 ms burst from the pin, still under
  D2, with `navigator.vibrate(20)` where supported. It is on the D3 allow-list by name.

### F. Enforcement

- **R26.** `src/lib/motion.contract.test.ts` reads the components and the stylesheet. It fails when:
  - the string `prefers-reduced-motion` appears in any source file other than `src/lib/motion.ts`
    and `src/index.css`, so `useMediaQuery("(prefers-reduced-motion…")` is caught as well as
    `matchMedia`;
  - the global reduced-motion block in `src/index.css` is missing or no longer targets `*`. That
    one block is what stills every CSS animation, so its presence is what is checked; a per-
    keyframe check could not fail while it exists;
  - a `duration-*`, a `transition`/`animation` over 300 ms, or a Tailwind animation utility
    (`animate-*`) appears without an entry in the file's allow-list. Each entry names its rule.
    Today's entries: `animate-pulse` on loading skeletons (R7, an arrival, carrying the
    information that results are on their way), R13, R25;
  - a component removes its focus outline without a `focus-visible:` ring and is not on R2's
    named exemptions.
- **R27.** Every new visual state gets a baseline that is reached by construction. Reduced motion
  is emulated **before** navigation, and no capture depends on an observer or a timer firing
  during it.
- **R28.** Every new assertion in this spec is mutation-tested: break the code it guards, watch
  that test fail, restore it. Review continues until a round finds nothing (CON-PROC-009).

## Edge cases / failure modes

- **Polar day and night do not occur in India.** `sun.ts` still returns "no sunrise" rather than
  a wrong time for a latitude where the sun does not set or rise, and that is tested. A wrong
  sunrise is worse than none (D1).
- **The device clock is wrong, or set to another time zone.** R8 always shows times in IST and
  labels them, so a traveller's phone set to another zone does not move the sunrise. R10 uses the
  device's month, which is the person's present, and is right even then.
- **The empty-list suggestion and the cell index disagree** (a stale index). Covered by R18's
  last clause.
- **The 404 matcher finds two equally good candidates.** It offers neither as "did you mean" and
  shows search, because a confident wrong correction is worse than an honest search box.
- **A social card's name contains a glyph the bundled font lacks.** The card falls back to the
  global one (R4), and that is tested with a Devanagari name.

## Out of scope / not done

- **Sound.** See the five rules.
- **Bulk basemap downloading for delight or for offline use.** Forbidden by the tile providers'
  terms (spec 43 §D).
- **Trail duration, "start by" times and pacing.** No record carries `durationHrs` (0 of 120,441
  measured), so any such number would be invented (D1). This returns if a source supplies it.
- **Height and ridge-aware sunrise** (a dip from elevation, or a horizon cast from the DEM). The
  standard value is honest and labelled; a corrected one needs the real horizon, not sea level. A terrain horizon is a later enrichment, not delight.
- **A count-up on the stats card.** The number should be read, not watched. Considered and
  rejected.
- **Onboarding tours.** The map is the onboarding.

## Verification

**Not yet implemented.** Every test file and command below is the target this spec commits to.
None of them exists until the PR that implements its rule; each PR's revision row records when
its rows became real.

```sh
npx vitest run src/lib/seo.test.ts scripts/lib/trekPage.test.ts      # R1
npm run check:deploy                                                  # R1 against the live site
npx vitest run src/lib/sun.test.ts                                    # R8, R9, polar edge
npx vitest run src/lib/motion.test.ts                                 # D2 helper: false without matchMedia
npx vitest run src/lib/voice.test.ts                                  # R10, R11, R14, R15, R18
npx vitest run src/lib/notFound.test.ts                               # R16 matcher, incl. refusal
npx vitest run src/lib/motion.contract.test.ts                        # R2, R6, R26 (D2, D3)
npx vitest run src/components/CommandPalette.test.tsx                 # R19
npx vitest run src/components/TrekDetail.test.tsx                     # R8, R10, R20
npm run check:size                                                    # R5
npm run e2e:app                                                       # R2 focus, R3 print text, R13 (both contexts), R18, R21
npm run e2e:static                                                    # R3 static print, R16, R17 (routed 404), R22
```

Print (R3) is asserted with Playwright `page.emulateMedia({ media: "print" })` against the text
and the absence of chrome. Its `page.pdf()` output is a CI artefact for a person to look at, not
a gate.

## Revisions

| Date       | Change                                                                                                                                                          | Covered by |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 2026-10-03 | Written: the five rules, a register of sixteen surfaces observed today, R1–R28. R23–R25 recorded as proposed, pending the owner's approval. Spec only, no code. | —          |

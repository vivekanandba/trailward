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
  happens today, observed on 2026-10-03, not assumed. A reviewer can disagree with one row
  without re-arguing the whole spec.
- **It is bounded by five rules, not a ban list.** Portfolio is a résumé, so it had to read as
  restrained: one set-piece, 300 ms everywhere, "no confetti, ever". Trailward is a tool for going
  outside, and some joy suits it. Inside the five rules anything is allowed.

**This spec grows one PR at a time.** Its requirements cover only what the next PRs build: the
structured-data defect and the basics (R1–R8). Each later piece of the register — the set-pieces,
the blank moments — gets its requirements written into this spec **in the PR that implements
it**, next to the code they describe. An earlier draft specified all four phases up front, and
five review rounds found 50 defects in it, most of them forecasts about code that did not exist
yet. What those rounds learned is kept under "Constraints learned in review" so it is not
re-learned.

## The five rules

These are the hard limits. Every requirement, now and later, is a consequence of one of them.

- **D1 — Delight never invents a fact.** Every sentence, number or drawing comes from a field we
  hold, or from arithmetic on fields we hold. When an input is missing, its clause is **omitted,
  not filled**: no "about", no plausible default, no "usually" (CON-DATA-001, CON-DATA-002). This
  is the rule most at risk here, because 120k sparse records make filling the silence tempting.
- **D2 — Every movement has a still version.** CSS motion is already cut globally under
  `prefers-reduced-motion` (`src/index.css`). JavaScript motion reads the preference through
  **one** module, `src/lib/motion.ts` (R8).
- **D3 — The map stays usable.** Nothing blocks a pan, steals focus or delays a tap. Motion over
  300 ms is allowed only when it carries information. Motion of the map, or of anything the
  person is acting on, stops the moment they act. A loading indicator moves nothing the person
  is acting on, and it ends when the loading does. Every such motion is on R8's allow-list with
  its rule beside it.
- **D4 — Everything visual has a text equivalent that says the same thing,** and keyboard focus
  is always visible.
- **D5 — It pays its weight.** A size budget gate (R5) exists before any delight ships. An
  addition that brings a dependency names its cost in the PR.

**Explicitly allowed** (portfolio forbade these): more than one set-piece, motion over 300 ms
when it carries information, playful copy, a short celebration of something the person did, and
`navigator.vibrate` on supporting devices (gated by D2).

**Explicitly out:** sound (people use this on trails and in shared rooms), autoplaying anything,
scroll-jacking, and motion on page load with no action or data arrival behind it.

## Register — the surfaces, as observed on 2026-10-03

| #   | Surface                            | Today (observed)                                                                                                                                                                                                                                                                       | Kind                                                                                                                                                                                | Requirements |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 0   | Static pages' JSON-LD              | **3,815 of 3,886** pages put a `url` in their structured data that 404s live: `trekJsonLd` uses `trek.id` (`seo.ts:140`), the page uses the slug (`pages.ts:14`)                                                                                                                       | **defect**                                                                                                                                                                          | R1           |
| 1   | Focus                              | `focus-visible` is styled only in `ui/Button.tsx`; seven places set `outline-none` (R2 names them)                                                                                                                                                                                     | absence                                                                                                                                                                             | R2           |
| 2   | Print                              | No `@media print` anywhere                                                                                                                                                                                                                                                             | absence                                                                                                                                                                             | R3           |
| 3   | Social card                        | One global `icons/og.png` for every page                                                                                                                                                                                                                                               | absence                                                                                                                                                                             | R4           |
| 4   | Size                               | No size budget. `dist/assets` is 768,325 bytes                                                                                                                                                                                                                                         | absence                                                                                                                                                                             | R5           |
| 5   | Theme toggle                       | Hard icon swap                                                                                                                                                                                                                                                                         | surface                                                                                                                                                                             | R6           |
| 6   | Sparse peak detail                 | Numbers only for nearly all 120k records                                                                                                                                                                                                                                               | blank → deep                                                                                                                                                                        | later        |
| 7   | Origin change                      | The map jumps                                                                                                                                                                                                                                                                          | surface → deep                                                                                                                                                                      | later        |
| 8   | Region stats card                  | Accurate, reads like a dashboard                                                                                                                                                                                                                                                       | voice                                                                                                                                                                               | later        |
| 9   | 404                                | `public/404.html` redirects to the app root and **drops the path**; a dead `/t/<slug>/` lands on the default map without a word                                                                                                                                                        | blank moment                                                                                                                                                                        | later        |
| 10  | Empty result list                  | Advises "try widening the radius", with no control that does it                                                                                                                                                                                                                        | blank moment                                                                                                                                                                        | later        |
| 11  | Palette with no matches            | A status message only                                                                                                                                                                                                                                                                  | blank moment                                                                                                                                                                        | later        |
| 12  | Unnamed peak                       | The label `Unnamed peak`; naming actions exist further down (specs 28/29)                                                                                                                                                                                                              | blank moment                                                                                                                                                                        | later        |
| 13  | Offline                            | Nothing says so                                                                                                                                                                                                                                                                        | blank moment                                                                                                                                                                        | later        |
| 14  | Console                            | Silent                                                                                                                                                                                                                                                                                 | small                                                                                                                                                                               | later        |
| 15  | Personal layer ("Been there")      | None                                                                                                                                                                                                                                                                                   | **proposed, needs the owner's approval** — it adds state, so it is a feature, not polish                                                                                            | later        |
| 16  | Distance from a non-default origin | All **16** curated treks carry a road distance _from Bengaluru_ (`distanceKm`), and the filter, the map popup and the detail prefer it whatever the origin (`filters.ts:37`, `TrekMap.tsx:193`, `TrekDetail.tsx:268`). From Mysuru, Skandagiri is listed at 67.6 km; it is 176 km away | **defect, own PR**, in spec 05                                                                                                                                                      | —            |
| 17  | Page URLs are not stable           | `slugMap` (`pages.ts:77`) gives the bare slug to whichever same-named record comes first in `treks.json`; the rest get `<slug>-<id>`. 456 pages are suffixed, 438 of them with `d12-` ids, which change when the terrain scan reruns, so those URLs die silently                       | **defect, own PR**, in spec 35. Sorting by id is **not** a fix (it would move 322 live URLs and still depend on unstable ids); it needs a persisted slug assignment, designed there | —            |

## Requirements

### A. The defect first

- **R1.** A static trek page's JSON-LD `url` equals its canonical URL. `trekJsonLd` takes the
  page's URL instead of deriving one from the id, so the two cannot disagree. Two tests enforce
  it:
  - **The guarantee:** a build test over **every** generated page asserts the equality.
  - **The live backstop:** `check-deploy` reads the live `sitemap.xml` and walks its `/t/` pages
    from the **end**. Each static page names its record in its "Open on the map" link
    (`?sel=<id>`), so the check knows which pages have a slug that differs from the id. It
    asserts the equality on the first three such pages it finds. It walks from the end because
    the sitemap opens with curated pages, whose ids equal their slugs. If it finds no such page
    within the first 50 it walks, it fails with "could not find a sample", a different message
    from "the url is wrong" (CON-VER-005). The build test is the guarantee; this is the live
    backstop.

  It ships alone and first.

### B. Absences that read as carelessness

- **R2.** Every element a person can reach with Tab shows a visible focus ring, from one global
  `:focus-visible` rule. No component removes its outline without replacing it with a
  `focus-visible:` or `focus:ring` style. The seven `outline-none` sites, by name:
  - **To fix:** the palette input, `CommandPalette.tsx:125`, which removes the outline and adds
    nothing.
  - **Already compliant:** `FilterBar.tsx:146` and `OriginSearch.tsx:117`, which add
    `focus:ring-2`.
  - **Exempt:** containers focused only from code (`tabIndex={-1}`), never by Tab: `#results`
    (`TrekList.tsx:35`), the palette dialog (`CommandPalette.tsx:109`), the sheet
    (`Sheet.tsx:177`) and the detail panel (`App.tsx:619`).
- **R3.** Printing a trek produces a **trail card**, not a screenshot, both from the static page
  (`/t/<slug>/`) and from the in-app detail. The card carries:
  - the name;
  - coordinates in decimal **and** degrees-minutes-seconds;
  - elevation, season and nearest town, each omitted when the record lacks it (D1);
  - the directions URL written out in full;
  - a date. In the app this is the print date, added on `beforeprint`. A static page has no client
    JS (spec 35), so its card says **"Built on &lt;date&gt;"**, the fact it actually knows, and
    never calls it a print date (D1).

  It leaves out map tiles, navigation, buttons and the sheet chrome, prints ink on white whatever
  the screen theme, and splits no fact table across a page. The point is a paper backup for a
  trailhead with no signal.

- **R4.** Each static trek page gets its own social card, generated at build from the record:
  - the name;
  - the elevation;
  - the nearest town, omitted when the record has none (records carry no region, spec 30);
  - the trek's mark.

  All text is drawn from bundled glyphs. A page uses the global card when **any** text the card
  draws (the name or the nearest town) has a glyph the font lacks, or when its card exceeds R5's
  per-card budget. R5 ships before R4, so the budget exists before the first card does (D5). The PR that adds cards records the
  measured per-card size and total in Revisions.

- **R5.** `npm run check:size` fails the build when the app's own output exceeds its budget:
  - `dist/assets` (JS+CSS), budgeted in bytes;
  - files this spec generates per page (none yet; the social cards once R4 lands), budgeted in **bytes per page**.
    Their total grows with the page count, which the unattended weekly refresh changes, and an
    absolute ceiling would block the cron's deploy on a person.

  The dataset itself (`treks.json`, the cells) belongs to the drift guard (spec 31), not this
  gate. A budget is a ceiling, so it ratchets **down**: after a reduction it is tightened to just
  above the new figure. It is raised only in a reviewed change that states the cause and the new
  figure.

- **R6.** The theme toggle's new icon rotates in when pressed. The rotate class is applied only
  when the press count is above 0, so the first render at load never animates. A React key alone
  is not enough, because a remount at key 0 plays a CSS animation too. Under D2 it is still. A
  unit test asserts that the first render has no animation class and that a press adds it.
- **R7.** Nothing animates on page load unless data is arriving. Every movement answers either
  an action (a press, a search) or an arrival (cells loading), and closing anything is instant.
  It is testable at the one place it is broken today. A deep link with `?sel=` restores the
  selection on load (`App.tsx:84`), which mounts the detail panel with `.panel-enter` and its
  scrim with no press behind them. A selection restored from the URL opens **without** the
  enter animation. An e2e test, run with motion allowed, loads a `?sel=` URL and asserts the
  panel has no running animations, and that a click-opened panel does.

### C. Enforcement

- **R8.** Motion is enforced from the code, not from memory:
  - **The helper.** `src/lib/motion.ts` exports `prefersReducedMotion()` and a hook
    `usePrefersReducedMotion()`. Both report **false** when `matchMedia` is missing, so jsdom
    takes the animated branch and a test opts into the still one. The hook reuses `useMediaQuery`
    through a new optional `fallback` argument. That hook keeps its default of `true`, which App's
    desktop split depends on. The two inline queries today (`Sheet.tsx:40`, `TrekMap.tsx:116`)
    move into it.
  - **The contract test,** `src/lib/motion.contract.test.ts`, reads the non-test source
    (`src/**/*.{ts,tsx,css}`, excluding `*.test.*`), and the inline `STYLE` of the static pages
    (`scripts/lib/trekPage.ts`, `scripts/lib/contentPage.ts`). Those pages carry their own
    stylesheet, so R2's focus rule must be in it too, and the test checks that it is. It fails
    when:
    - the string `prefers-reduced-motion` appears anywhere other than `src/lib/motion.ts` and
      `src/index.css`, comments included (the comment at `Sheet.tsx:76` is reworded);
    - the global reduced-motion block in `src/index.css` is missing or no longer targets `*`;
    - any motion **over 300 ms** has no allow-list entry naming its rule. It counts:
      - Tailwind `duration-*`;
      - bare `transition*` classes, at Tailwind's 150 ms default;
      - `animate-*` utilities, at their defined duration;
      - CSS `transition`/`animation`;
      - string literals assigned to `style.transition`/`style.animation`;
      - Leaflet `panTo`/`fitBounds`/`setView`/`flyTo`/`flyToBounds` with animation on, at
        Leaflet's 0.25 s default unless a duration is passed. `flyTo`/`flyToBounds` always need an
        entry, because their duration is computed;
      - WAAPI `.animate(`.
    - an animated Leaflet call (`TrekMap.tsx:146`, `:169`, `:334` today) does not take its
      preference from `src/lib/motion.ts`;
    - a component sets `outline-none` without a `focus-visible:` or `focus:ring` replacement and
      is not on R2's **exempt** list. The "to fix" list is not an exemption: the palette input
      fails until it is fixed, and fails again if the fix is reverted.

    Today's allow-list holds one entry: `animate-pulse` (2 s, repeating) on loading skeletons. It
    is a loading indicator under D3: it moves nothing the person acts on, and it is gone once the
    cells arrive.

  - Every new visual state gets a baseline reached by construction: reduced motion emulated
    **before** navigation, and no capture that waits on an observer or a timer.
  - Every new assertion is mutation-tested (CON-PROC-005), and review ends on a clean round
    (CON-PROC-009).

## Constraints learned in review — for the requirements still to be written

Not requirements. These are facts about the codebase that five review rounds of the earlier
draft established, recorded so the PR that specifies each piece starts from them.

- **Set-pieces (sunrise, "is now a good time?", the search arriving, the region sentence).**
  - **Sunrise:** use the standard definition (the sun's **centre** at −0.833°) and no elevation
    dip, because a summit's real horizon is a plateau or ridge, not sea level. Show times in IST:
    the data spans 6.8–36.0° N, 68.2–97.4° E. A wrong device clock makes both the month and the
    day wrong; say so rather than claim robustness.
  - **Season sentence:** all 120,441 records have a climate cell. 254 have no dry month, and that
    branch must be designed, not assumed away. Malformed monthly data must yield no sentence,
    because `driestMonths` returns `[]` for both "no dry month" and bad input.
  - **Map:** `FitToResults` (`TrekMap.tsx:155`) already moves the map on origin change and when
    results first appear. A fly-to must replace that branch, not compete with it. The default e2e
    context forces reduced motion, so the animated branch needs its own context, with cell
    responses held to make the order deterministic.
  - **Region sentence:** `regionStats` summarises the **filtered** set and has no peak name or
    gem count. Unnamed records are named `Unnamed peak (~…)`, `Unnamed hill (~… m)` (31,774) and
    `Unnamed Peak` (732), and none of them may lead a sentence.
- **Blank moments.**
  - **404 page:** `vite preview` serves `index.html` for unknown paths, never `404.html`, so the
    e2e must route `404.html` at the original URL. `public/` is copied verbatim, so a tested
    matcher must come in through a Vite input (and must be kept out of `structuredData()`'s
    JSON-LD injection). The worker serves `data/` stale-while-revalidate, so verify an offered
    link (`HEAD`) before offering it. URL instability is register row 17, and its fix comes first.
  - **Empty list:** a failed cell is dropped silently and an index failure becomes `[]`
    (`App.tsx:167`), so an empty list is not proof of an empty radius. "Clear filters" resets the
    radius too (`App.tsx:513`). Any suggested radius states no peak distance, because the cell
    corner it is computed from is not a peak.
  - **Console greeting:** assert it on the production build. Dev-server and React messages exist
    under `npm run dev`. `stubApis` aborts hosts, and Chromium logs every abort.
  - **Offline:** the installed app can open already offline, and no `offline` event fires then.
    The worker does not cache cross-origin basemap tiles.
- **Personal layer.** `localStorage` only, with every access wrapped. It waits for the owner's
  decision.

## Edge cases / failure modes

- **A printed card for a record with almost nothing.** Name and coordinates always exist, so the
  card is never empty. Every other line is omitted when its field is absent, never printed as
  "—" or "unknown" (D1).
- **A social card whose name or nearest town is in Devanagari or has diacritics.** It renders from
  bundled glyphs, or the page uses the global card. That is tested with a name, and separately with
  a town.
- **`matchMedia` missing (jsdom, old browsers).** The motion helper reports "no preference" and
  the animated branch runs, so tests must opt into reduced motion deliberately (R8).

## Out of scope / not done

- **Sound,** for the reason in the five rules.
- **Bulk basemap downloading,** for delight or offline use. The tile providers' terms forbid it
  (spec 43 §D).
- **Trail duration, "start by" times and pacing.** No record carries `durationHrs` (0 of 120,441
  measured), so any such number would be invented (D1).
- **A count-up on the stats card.** The number should be read, not watched.
- **Onboarding tours.** The map is the onboarding.

## Verification

**Not yet implemented.** The commands below are what will verify each requirement. Some of these
files and commands exist and pass **today** (`seo.test.ts`, `trekPage.test.ts`, the component
tests, `check:deploy`, the three e2e projects), but they test today's behaviour, not these
requirements (CON-VER-007). A requirement counts as verified only once its PR's Revisions row names the tests
it added.

```sh
npx vitest run src/lib/seo.test.ts scripts/lib/trekPage.test.ts scripts/build-pages.test.ts  # R1
npm run check:deploy                                       # R1 live: the sitemap's last five pages
npx vitest run src/lib/motion.test.ts src/lib/motion.contract.test.ts                # R2, R6, R7, R8
npx vitest run src/lib/coords.test.ts                      # R3 degrees-minutes-seconds
npm run check:size                                         # R5, proven able to fail
npm run e2e:app                                            # R2 focus ring visible, R3 in-app print, R7 deep link
npm run e2e:static                                         # R3 static print ("Built on"), R4 meta
```

R3 is asserted with Playwright `page.emulateMedia({ media: "print" })` against the text and the
absence of chrome. Its `page.pdf()` output is a CI artefact for a person to look at, not a gate.

## Revisions

| Date       | Change                                                                                                                                                                                                                                                                                                                                                             | Covered by |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 2026-10-03 | Written with the five rules, a register of 18 surfaces and R1–R8. A first draft specified all four phases (R1–R28). Five review rounds on PR #76 found 50 defects, mostly forecasts about code not yet written, so later requirements will be written in the PRs that implement them. What those rounds established is kept under "Constraints learned in review". | —          |

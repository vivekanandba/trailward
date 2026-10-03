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

**This spec is written one step ahead of the code, not four.** Its requirements cover only what
the next PRs build: the structured-data defect and the basics (R1–R7). Each later piece of the
register — the set-pieces, the blank moments — gets its requirements added here in a **spec PR
that lands before** the code that implements it, as CON-PROC-001 requires. The change is how far
ahead, not whether. An earlier draft specified all four phases at once, and five review rounds
found 50 defects in it, most of them forecasts about code that did not exist yet. Cutting it to
this scope did **not** stop the findings: three more rounds found ten each. They were narrower
and concrete, about today's code rather than imagined code, but the count did not fall. That
lesson, with this mixed evidence, is drafted for the fleet in `docs/proposals/2026-10-03-con-proc-specify-one-step-ahead.md`. What the
rounds established about the codebase is kept under "Constraints learned in review".

## The five rules

These are the hard limits. Every requirement, now and later, is a consequence of one of them.

- **D1 — Delight never invents a fact.** Every sentence, number or drawing comes from a field we
  hold, or from arithmetic on fields we hold. When an input is missing, its clause is **omitted,
  not filled**: no "about", no plausible default, no "usually" (CON-DATA-001, CON-DATA-002). This
  is the rule most at risk here, because 120k sparse records make filling the silence tempting.
- **D2 — Every movement has a still version.** CSS motion is already cut globally under
  `prefers-reduced-motion` (`src/index.css`). JavaScript motion reads the preference through
  **one** module, `src/lib/motion.ts` (R7).
- **D3 — The map stays usable.** Nothing blocks a pan, steals focus or delays a tap. Motion over
  300 ms is allowed only when it carries information. Motion of the map, or of anything the
  person is acting on, stops the moment they act. A loading indicator moves nothing the person
  is acting on, and it ends when the loading does. Every such motion is on R7's allow-list with
  its rule beside it.
- **D4 — Everything visual has a text equivalent that says the same thing,** and keyboard focus
  is always visible.
- **D5 — It pays its weight.** A size budget gate (R4) exists before any delight ships. An
  addition that brings a dependency names its cost in the PR.

**Explicitly allowed** (portfolio forbade these): more than one set-piece, motion over 300 ms
when it carries information, playful copy, a short celebration of something the person did, and
`navigator.vibrate` on supporting devices (gated by D2).

**Explicitly out:** sound (people use this on trails and in shared rooms), autoplaying anything,
scroll-jacking, and motion on page load with no action or data arrival behind it.

## Register — the surfaces, as observed on 2026-10-03

| #   | Surface                            | Today (observed)                                                                                                                                                                                                                                                                       | Kind                                                                                                                                                                                | Requirements |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 0   | Static pages' JSON-LD              | **3,815 of 3,886** pages put a `url` in their structured data that 404s live: `trekJsonLd` uses `trek.id` (`seo.ts:140`), the page uses `slugMap`'s slug (`pages.ts:77`), which adds `-<id>` on a name collision                                                                       | **defect**                                                                                                                                                                          | R1           |
| 1   | Focus                              | `focus-visible` is styled only in `ui/Button.tsx`; seven places set `outline-none` (R2 names them)                                                                                                                                                                                     | absence                                                                                                                                                                             | R2           |
| 2   | Print                              | No `@media print` anywhere                                                                                                                                                                                                                                                             | absence                                                                                                                                                                             | R3           |
| 3   | Social card                        | One global `icons/og.png` for every page                                                                                                                                                                                                                                               | absence                                                                                                                                                                             | later        |
| 4   | Size                               | No size budget. JS+CSS in `dist/assets` is 674,629 bytes                                                                                                                                                                                                                               | absence                                                                                                                                                                             | R4           |
| 5   | Theme toggle                       | Hard icon swap                                                                                                                                                                                                                                                                         | surface                                                                                                                                                                             | R5           |
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
| 18  | Diacritics in names                | The bundled Inter and Bricolage woff2 are Latin-only subsets with no `ā`, `ī` or `ū` (checked with fontTools); 1,944 of the 3,886 page names contain a character above U+00FF, so those letters render in a fallback font mid-word                                                     | absence; a later spec PR adds the Latin Extended subset, and social cards wait for it                                                                                               | later        |

## Requirements

### A. The defect first

- **R1.** A static trek page's JSON-LD `url` equals its canonical URL. `trekJsonLd` takes the
  page's URL instead of deriving one from the id, so the two cannot disagree. Two tests enforce
  it:
  - **The guarantee:** a build test over **every** generated page asserts the equality.
  - **The live backstop:** `check-deploy` reads the live `sitemap.xml` and walks its `/t/` pages.
    Each static page names its record in its "Open on the map" link (`?sel=<id>`), so the check
    can tell which pages have a slug that differs from the id. It asserts the equality on the
    first three such pages. If none turns up within the first 50 it walks, it fails with "could
    not find a sample", a different message from "the url is wrong" (CON-VER-005). The check
    chooses its sample by reading each page rather than by the sitemap's order, because order
    is not a property anyone guarantees. Today's sample, `t/skandagiri/`, has slug = id, so it
    could never see this defect.

  It ships alone and first.

### B. Absences that read as carelessness

- **R2.** Every element that receives keyboard focus shows a visible focus ring, from one global
  `:focus-visible` rule. No component removes its outline without replacing it with a
  `focus-visible:` style. There are **no exemptions**. A container that has `tabIndex={-1}` is
  still reached from the keyboard: the skip link focuses `#results` (`TrekList.tsx:35`), and
  Enter on a result focuses the detail panel (`App.tsx:619`). The global rule also loses on
  specificity to a component's own `focus:outline-none`, so each site must be changed, not
  merely covered. The seven `outline-none` sites:
  - **Get a `focus-visible:` ring:** the palette input (`CommandPalette.tsx:125`), `#results`,
    the detail panel, the palette dialog (`CommandPalette.tsx:109`) and the sheet
    (`Sheet.tsx:177`).
  - **Already compliant:** `FilterBar.tsx:146` and `OriginSearch.tsx:117`, whose `focus:ring-2`
    is converted to `focus-visible:ring-2`, so that one form is checked.
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

- **R4.** `npm run check:size` fails the build when the JS and CSS in `dist/assets` exceed their
  budget in bytes. The budget is set **when R4 lands**, from that build's measured size plus 5%
  headroom, so ordinary small PRs do not each have to raise it. On 2026-10-03 the figure was
  674,629 bytes, of 764,229 in the directory; the rest is committed woff2 fonts. Measure with
  `find -printf %s` on a fresh build. Apparent size, not `du`'s block count, which
  differs by filesystem. The dataset (`treks.json`, the cells) belongs to the drift guard
  (spec 31), not to this gate. A budget is a ceiling, so it ratchets **down**: after a reduction
  it is tightened to just above the new figure. It is raised only in a reviewed change that
  states the cause and the new figure. It ships before any other delight (D5).
- **R5.** The theme toggle's new icon rotates in when pressed. The rotate class is applied only
  when the press count is above 0, so the first render at load never animates. A React key alone
  is not enough, because a remount at key 0 plays a CSS animation too. Under D2 it is still.
  `ThemeToggle.test.tsx` asserts that the first render has no animation class and that a press
  adds it.
- **R6.** Nothing animates on page load unless data is arriving. Every movement answers either
  an action (a press, a search) or an arrival (cells loading), and closing anything is instant.
  Two places break this today, and both are fixed:
  - **Desktop:** a `?sel=` deep link restores the selection on load (`App.tsx:84`), which mounts
    the detail panel with `.panel-enter` with no press behind it. (The scrim renders at its final
    opacity and does not animate.) A selection restored from the URL opens **without** the enter
    animation.
  - **Mobile:** the sheet calls `applySnap(snap, true)` on mount (`Sheet.tsx:91`). Sheets mount
    when they open (`App.tsx:683`, `:704`), so a mount is usually a press and **should** slide.
    Two mounts are not presses: the results sheet at app load, and a detail sheet restored from
    `?sel=`. Those two are placed without a transition, through a prop the caller sets only for
    them. Every press-opened sheet slides in as now.
  - **Focus on a restored selection.** The panel and the sheet focus themselves on mount
    (`useDialogFocus.ts:34`). Under R2 that would draw a ring around the whole panel on every
    shared link, before anyone has touched the page. A selection restored from the URL therefore
    does not take focus; focus stays at the top of the document, as on any page load. A
    press-opened detail still takes focus.

  `e2e/motion.spec.ts` runs in a context with motion allowed, in both the desktop and the mobile
  project, each with its own selector (`.panel-enter` on desktop, the sheet on mobile). It
  asserts that nothing is animating, and nothing in the panel has focus, right after a `?sel=`
  load. It also asserts that a click-opened detail does animate.

### C. Enforcement

- **R7.** Motion is enforced from the code, not from memory:
  - **The helper.** `src/lib/motion.ts` exports `prefersReducedMotion()` and a hook
    `usePrefersReducedMotion()`. Both report **false** when `matchMedia` is missing, so jsdom
    takes the animated branch and a test opts into the still one. The hook reuses `useMediaQuery`
    through a new optional `fallback` argument. That hook keeps its default of `true`, which App's
    desktop split depends on. The two inline queries today (`Sheet.tsx:40`, `TrekMap.tsx:116`)
    move into it.
  - **The contract test,** `src/lib/motion.contract.test.ts`, reads the app's non-test source
    (`src/**/*.{ts,tsx,css}`, excluding `*.test.*`). It fails when:
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
    - the `MapContainer` (`TrekMap.tsx:397`) does not set `inertia`, `zoomAnimation`,
      `fadeAnimation` and `markerZoomAnimation` from the helper. Leaflet runs its own motion,
      such as the glide after a drag, which reads no stylesheet; today it uses the defaults;
    - a component sets `outline-none` without a `focus-visible:` replacement (R2).

    Today's allow-list holds one entry: `animate-pulse` (2 s, repeating) on loading skeletons. It
    is a loading indicator under D3: it moves nothing the person acts on, and it is gone once the
    cells arrive.

  - **The static pages** have their own inline stylesheets (`scripts/lib/trekPage.ts`,
    `scripts/lib/contentPage.ts`), which cannot load `src/index.css`. Their build tests assert
    that each stylesheet carries R2's focus rule. Any transition they add must carry its own
    `@media (prefers-reduced-motion: reduce)` block in that stylesheet. That is the one place
    besides the two files above where the string may appear, and the build test requires it
    whenever the stylesheet has a transition. The same over-300 ms rule and allow-list apply to
    these stylesheets, through the same function the contract test uses.
  - Every new visual state gets a baseline reached by construction: reduced motion emulated
    **before** navigation, and no capture that waits on an observer or a timer.
  - Every new assertion is mutation-tested (CON-PROC-005), and review ends on a clean round
    (CON-PROC-009).

## Constraints learned in review — for the requirements still to be written

Not requirements. These are facts about the codebase that the review rounds on PR #76
established, recorded so the PR that specifies each piece starts from them.

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
- **Social cards.** The fonts lack the glyphs half the page names need (register row 18), so
  cards wait for the Latin Extended subset. A card over its byte budget must **fail the build**,
  not quietly fall back to the global card: a fallback that hides growth turns the gate into a
  formality.
- **Personal layer.** `localStorage` only, with every access wrapped. It waits for the owner's
  decision.

## Edge cases / failure modes

- **A printed card for a record with almost nothing.** Name and coordinates always exist, so the
  card is never empty. Every other line is omitted when its field is absent, never printed as
  "—" or "unknown" (D1).
- **`matchMedia` missing (jsdom, old browsers).** The motion helper reports "no preference" and
  the animated branch runs, so tests must opt into reduced motion deliberately (R7).

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
npm run check:deploy                         # R1 live: three pages whose ?sel= id differs from the slug
npx vitest run src/lib/motion.test.ts src/lib/motion.contract.test.ts        # R2 outline sites, R7
npx vitest run scripts/lib/trekPage.test.ts scripts/lib/contentPage.test.ts  # R2, R7 static stylesheets
npx vitest run src/lib/coords.test.ts                                        # R3 degrees-minutes-seconds
npm run check:size                                                           # R4, proven able to fail
npx vitest run src/components/ThemeToggle.test.tsx                           # R5
npm run e2e:app                  # R2 focus ring visible, R3 in-app print, R6 (e2e/motion.spec.ts)
npm run e2e:static               # R3 static print ("Built on")
```

R3 is asserted with Playwright `page.emulateMedia({ media: "print" })` against the text and the
absence of chrome. Its `page.pdf()` output is a CI artefact for a person to look at, not a gate.

## Revisions

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                           | Covered by |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 2026-10-03 | Written with the five rules, a register of 19 surfaces and R1–R7. A first draft specified all four phases (R1–R28). Five review rounds on PR #76 found 50 defects, mostly forecasts about code not yet written. The spec was cut to this scope, and three further rounds found ten each, about today's code. Later requirements land in spec PRs ahead of their code. What the rounds established is kept under "Constraints learned in review". | —          |

# 44 — Delight: computed, earned, and never invented

## Purpose

Trailward is careful and honest, and it is silent about having a personality. A person who opens
one of its 120,441 peaks mostly gets a column of numbers: 194 records carry a photo, 34 a trail,
10 a history note. The facts are right, and the moment is blank.

This spec makes the app say more without saying anything untrue. It starts from the portfolio
repository's delight work (its specs 0004 and 0011) and departs from it in two ways:

- **It is a register, not a list of ideas.** Every surface below names what happens today,
  observed on 2026-10-03.
- **It is bounded by five rules, not a ban list.** Portfolio is a résumé and had to read as
  restrained. Trailward is a tool for going outside, and some joy suits it. Inside the five rules
  anything is allowed.

**How this spec grows.** It holds the rules, the register, and the requirements of work that has
shipped or is shipping. Each later piece of the register gets its requirements in the **same PR
as its code**, as this repo's spec workflow already asks (`specs/README.md`). Then review checks
each claim against code that exists. A first draft (PR #76) specified every phase ahead of the
code. Nine review rounds found more than 100 defects and did not converge, because requirements
about code that does not exist can only be checked by guessing. What those rounds established
about today's code is kept under "Constraints learned in review", so it is not re-learned.

## The five rules

- **D1 — Delight never invents a fact.** Every sentence, number or drawing comes from a field we
  hold, or from arithmetic on fields we hold. When an input is missing, its clause is **omitted,
  not filled**: no "about", no plausible default, no "usually" (CON-DATA-001, CON-DATA-002).
- **D2 — Every movement has a still version** under `prefers-reduced-motion`. That includes
  JavaScript motion and Leaflet's own animations, which no stylesheet reaches.
- **D3 — The map stays usable.** Nothing blocks a pan, steals focus or delays a tap. Motion over
  300 ms is allowed only when it carries information. Motion of anything the person is acting on
  stops the moment they act.
- **D4 — Everything visual has a text equivalent that says the same thing,** and keyboard focus
  is always visible.
- **D5 — It pays its weight.** A size budget gate exists before any delight ships.

**Explicitly allowed** (portfolio forbade these): more than one set-piece, information-carrying
motion over 300 ms, playful copy, a short celebration of something the person did, and haptics,
gated by D2.

**Explicitly out:** sound, autoplay, scroll-jacking, and motion on page load with no action or
data arrival behind it.

**Enforcement, stated rather than implied.** D1–D5 are **review-enforced** until the requirement
that implements each one names its check. R1 is enforced by the tests named under Verification.

## Register — the surfaces, as observed on 2026-10-03

| #   | Surface                            | Today (observed)                                                                                                                                                                                                                                                               | Requirement                                                 |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 0   | Static pages' JSON-LD              | **3,815 of 3,886** pages put a `url` in their structured data that 404s live. `trekJsonLd` built it from `trek.id`, but the page lives at a slug made from the name (`slugFor`, `pages.ts:14`), plus a `-<id>` suffix on a name collision (`slugMap`, `pages.ts:77`)           | **R1, defect**                                              |
| 1   | Focus                              | `focus-visible` is styled only in `ui/Button.tsx`; seven places set `outline-none`, and five of them add no replacement                                                                                                                                                        | **R3**                                                      |
| 2   | Print                              | No `@media print` anywhere                                                                                                                                                                                                                                                     | **R5**                                                      |
| 3   | Social card                        | One global `icons/og.png` for every page                                                                                                                                                                                                                                       | later; waits for row 18                                     |
| 4   | Size                               | No size budget. JS+CSS in `dist/assets` is 674,629 bytes, of 764,229 with fonts                                                                                                                                                                                                | **R2**                                                      |
| 5   | Theme toggle                       | Hard icon swap                                                                                                                                                                                                                                                                 | **R4**                                                      |
| 6   | Motion on load                     | A `?sel=` deep link mounts the panel with `.panel-enter` (`App.tsx:84`); the mobile sheet slides on mount (`Sheet.tsx:91`); `FitToResults` animates on mount (`TrekMap.tsx:169`)                                                                                               | **R4**                                                      |
| 7   | Sparse peak detail                 | Numbers only for nearly all 120k records                                                                                                                                                                                                                                       | **R6, R7**                                                  |
| 8   | Origin change                      | The map jumps                                                                                                                                                                                                                                                                  | **R9**                                                      |
| 9   | Region stats card                  | Accurate, reads like a dashboard                                                                                                                                                                                                                                               | **R8**                                                      |
| 10  | 404                                | `public/404.html` redirects to the app root and **drops the path**                                                                                                                                                                                                             | later; waits for row 17                                     |
| 11  | Empty result list                  | Advises "try widening the radius", with no control that does it                                                                                                                                                                                                                | later                                                       |
| 12  | Palette with no matches            | A status message only                                                                                                                                                                                                                                                          | later                                                       |
| 13  | Unnamed peak                       | The label `Unnamed peak`; naming actions exist further down (specs 28/29)                                                                                                                                                                                                      | later                                                       |
| 14  | Offline                            | Nothing says so                                                                                                                                                                                                                                                                | later                                                       |
| 15  | Console                            | Silent                                                                                                                                                                                                                                                                         | later                                                       |
| 16  | Distance from a non-default origin | All **16** curated treks carry a road distance _from Bengaluru_ (`distanceKm`), and the filter, map popup and detail prefer it whatever the origin (`filters.ts:37`, `TrekMap.tsx:193`, `TrekDetail.tsx:268`). From Mysuru, Skandagiri is listed at 67.6 km; it is 176 km away | **fixed** (spec 05, `tripDistance`)                         |
| 17  | Page URLs are not stable           | 456 pages carry a `-<id>` suffix, 438 of them with `d12-` ids that change when the terrain scan reruns, so those URLs die silently. Sorting by id is not a fix: it would move 322 live URLs                                                                                    | **fixed** (spec 35, slug registry)                          |
| 18  | Diacritics in names                | The bundled Inter and Bricolage woff2 are Latin-only subsets with no `ā`, `ī` or `ū` (checked with fontTools); 1,944 of the 3,886 page names use a character above U+00FF, so those letters render in a fallback font mid-word                                                 | **fixed** (spec 08, latin-ext faces)                        |
| 19  | Personal layer ("Been there")      | None                                                                                                                                                                                                                                                                           | proposed; needs the owner's approval, because it adds state |

## Requirements

- **R1.** A static trek page names its own URL as its canonical, and its JSON-LD `url` is that
  canonical. `trekJsonLd` takes the page's URL as an argument instead of deriving one from the id.
  One pure judgement, `jsonLdProblem()` (`scripts/lib/deploycheck.ts`), decides both checks
  below. The canonical must **equal** the page's production URL in full, and the JSON-LD url must
  equal the canonical. Self-consistency alone, or a match on the end of the path, would pass a
  canonical with an id-derived slug, a doubled base path or the wrong host. All of those 404.
  - **Every real page, every build.** `build-pages` applies `jsonLdProblem` to each of the
    ~3,886 pages it renders, and **fails the build** before writing any of them, so nothing
    deploys. (Inside `npm run build`, vite has already emptied `dist/`, so the previous build
    does not survive on disk; what the refusal protects is the deploy.) The expected URL is
    spelled out from `SITE_URL`, not built with `absoluteUrl` as the renderer does, so a bug in
    `absoluteUrl` cannot pass on both sides. Since `trekJsonLd` takes the canonical, the JSON-LD
    half agrees by construction; this check exists to catch a renderer regression on real data.
  - **The live check samples pages the build chose.** The build knows which pages have a slug
    that differs from their id, the only ones that can show this defect. It writes one of each
    **kind** into `version.json` as `jsonLdSample`, the first in build order of each:
    - curated;
    - collision-suffixed (`<slug>-<id>`);
    - GeoNames (`gn-`);
    - terrain-detected (`d12-`);
    - OpenStreetMap (`osm-`, not `osmx-`, a separate source).

    A sample from the head of the sitemap would always be the same few curated pages, and would
    pass a regression limited to generated pages. The build **refuses** when no page qualifies,
    because the live check could then only fail after publishing. It **logs a warning** for each
    kind it has no page of, so the sample never shrinks silently.

  - `check-deploy` reads that sample only from the `version.json` it has just verified as this build's, and fetches the pages in parallel. It spells out each expected URL from `SITE_URL`, as the build does, rather than reusing the renderer's `absoluteUrl`. `version.json` is itself fetched cache-busted, so the sample can never come from a different build than the
    pages it checks: a stale sitemap or a CDN-cached old page cannot be mistaken for this
    defect (CON-VER-005). If the site is not serving the build just made, the sample is not run, and is logged as
    such rather than reported as a failure; the version check already fails the deploy. If `version.json` lists no valid sample, the check fails, because a build that
    chose none has verified nothing.
  - Each sampled page is fetched cache-busted. A thrown request, 5xx, 408 or 429 is retried once,
    as CDN turnover or rate limiting; a 404 or a wrong url is judged at once. A page that cannot
    be read fails, naming what is missing.
  - The fixed sample `t/skandagiri/` stays in the deploy surface for what it checks (the page
    exists and is not a soft 404). Its slug equals its id, so it could never see this defect.

- **R2 — the size budget (row 4, rule D5).** `npm run check:size` (`scripts/check-size.ts`)
  measures the build's apparent bytes in three categories and fails when any exceeds
  `size-budget.json`:
  - `initialJsCss`: the JS and CSS `dist/index.html` references, which the first paint waits for;
  - `totalJsCss`: every JS and CSS asset, lazy chunks included;
  - `fonts`: every woff2.

  It also fails when the budget file is missing or lacks a category, when `index.html`
  references no asset, or one that is not there: a measure of nothing proves nothing. It runs
  after the build in CI (`e2e-static`) and in the deploy's build job, before upload. The budget
  sits a little above what ships, so a small PR need not touch it; a PR that adds weight raises
  it in review, and one that saves weight lowers it, which is how it ratchets down.
  The fonts budget went from 95,000 to 200,000 B with the latin-ext faces (row 18): they total
  193,336 B on disk. The browser itself fetches a latin-ext face only for a name that needs it,
  but the offline service worker (spec 43) precaches every asset the CSS names on its first
  install, so in practice each device downloads them once (~104 KB): the price of ā ī ū ṭ in the
  app's own type for 1,944 page names, paid knowingly.

- **R3 — keyboard focus is always visible (row 1, rule D4).** One `:focus-visible` rule in
  `index.css` draws a 2 px outline on anything that does not style its own focus. No component
  removes an outline without a visible ring in its place: the five that did (the result list,
  the detail panel, the palette and its input, the sheet) now draw one, inset where the element
  meets the viewport edge. `:focus-visible`, not `:focus`, so a click or a programmatic focus
  with no keyboard behind it draws nothing: a deep-linked panel takes focus on load and shows no
  ring.
- **R4 — motion answers an action (rows 5 and 6, rules D2 and D3).** Every movement asks
  `src/lib/motion.ts`:
  - `prefersReducedMotion()` for script-driven motion, which no stylesheet reaches (Leaflet's
    pans and fits, the sheet's transform); CSS motion is stilled by the global rule;
  - `shouldAnimate()`, which is false until the person first presses a key or a pointer, so
    nothing moves on load: a `?sel=` deep link shows the panel in place and the sheet at its
    snap, the first map fit and the deep-linked pan jump. The panel's slide is decided when it
    opens and held while it stays open, so a later press cannot replay it.
  - The theme toggle's icon turns in (240 ms) after each press, keyed to the press count, and
    never on load.
  - Nothing lasts longer than 300 ms unless it is on the named allow-list in
    `src/motion.contract.test.ts`, which is empty. That covers Tailwind's looping animations
    (`animate-pulse` and kin, 1–2 s and infinite) and seconds in CSS, not only `ms` values: the
    loading skeletons pulsed on load until review found it, and they are now still.

- **R5 — a trek prints as a field card (row 2).**
  - **In the app,** with a trek open, paper gets its detail as a full-width card: the map, the
    header, the result list and every button are hidden. A print-only block carries what the
    buttons would have done: the coordinates in degrees-minutes-seconds (`toDms`,
    `src/lib/coords.ts`, rounded to the second and zero-padded), the directions URL written out,
    and "Printed from Trailward on <date>" in India time, refreshed on `beforeprint`. With no
    trek open, the result list prints (on desktop; on a phone the list sheet is not yet laid out
    for paper, recorded as a limit). The sheet's inline position is overridden, so a mobile print
    of a trek is not clipped to the screen. No scrim prints (a fixed one repeated over every page),
    a dark-mode page prints in the light theme (the `dark` class comes off on `beforeprint` and
    returns on `afterprint`), and nothing transitions on paper, so no colour prints mid-ease.
  - **On a static page,** the facts table gains a DMS row, a print-only line gives the
    directions URL, and the footer says "Data as of <date>", the date of the last commit to
    `treks.json`: the page runs no script, so it cannot know the day it is printed. A shallow clone
    gives no date at all rather than its own (its one commit "touched" everything, which dated
    every page with the deploy day), and the build jobs fetch full history without file contents
    (`filter: blob:none`) and read the date once in a plain step, passing it to the build as
    `TRAILWARD_DATA_DATE`: inside Playwright's web server on GitHub's runner, git reported the
    full clone as shallow while a plain step in the same job saw it whole (cause not found). That
    step is one action, `.github/actions/data-date` (`scripts/data-date.sh`), which every job that
    builds the pages uses before it builds, and which fails on a shallow clone or a blank date
    (issue #94; `scripts/data-date.test.ts`, `scripts/workflows.test.ts`). The
    sitemap's `lastmod` shares that date and the fix. The
    call-to-action's row and the back link are hidden in print.
  - Playwright's print emulation never fires `beforeprint`, so the date's refresh is unit-tested
    and the layout is checked in e2e.

- **R6 — sunrise and sunset, computed (row 7).** The detail panel says "Sunrise 06:05 and
  sunset 18:43 today (IST); the sun comes up in the east-northeast", beside a small drawing of the
  two bearings whose label is that sentence. `src/lib/sun.ts` uses NOAA's general solar position
  equations for the sun's centre at −0.833°, on today's date **in India**, whatever the device's
  zone; no correction for the summit's height (stated). It agrees with the US Naval Observatory
  (`src/lib/__fixtures__/usno-sun.json`, fetched 2026-10-31) within 2 minutes (worst: 1) at 8.5°,
  21.1° and 34.2° N on both solstices and an equinox. A day the sun does not cross the horizon is
  said plainly, never given a time.
- **R7 — is now a good time? (row 7).** The rainfall chart outlines this month, and a sentence
  says whether it falls in the cell's drier stretch ("Now is the drier stretch here (Dec–Mar),
  going by rainfall"). A cell with no clear dry season, or malformed data, gets no sentence:
  `driestMonths` returns `[]` for both, and neither is a fact about the season.
- **R8 — the area card opens with a sentence (row 9).** "601 peaks around Bengaluru, most of
  them easy; the highest stands at 1712 m, and the top hidden gem is Kumbārachi Kallu", built
  only from `regionStats`. A spread with no majority is "a mix of …"; a missing figure drops its
  clause; an "Unnamed peak" never leads one. A property test removes each optional figure in
  every combination and rejects `undefined`, `NaN`, empty clauses and dangling joins.
- **R9 — a new origin flies (row 8).** After an action, a change of origin flies the map to the
  new bounds (0.8 s, on the named allow-list: the motion shows where the new place is from the
  old); a radius change animates briefly; the first fit jumps. Under reduced motion every one
  jumps. Leaflet stops a flight the moment the person drags. The contract test also reads
  Leaflet's `duration`, which is in seconds.

- **R10 — a missing page says so (row 10).** `404.html` is built by vite from the repo root,
  not copied from `public/`, so its decisions are the tested `src/notFound.ts`:
  - a missing trek page (`/t/<slug>/`) stays on the 404 page, says there is no trek page at that
    address, and, when one slug in the sitemap is clearly closest (`bestMatch`), offers it as a
    link. A tie, or a match under the similarity floor, offers nothing: a guess is not an answer.
    Offline or without a sitemap the page keeps its plain message;
  - any other missing path goes into the app, handing it the query and hash as before (the app
    then writes its own state into the URL, so a deep link's filters survive).
- **R11 — an empty list is honest and actionable (row 11).** When filters leave nothing, the
  list offers "Widen to N km" (double the radius, capped at the largest), which does what the
  advice says. When cells of the area failed to load (`loadCellsReport` counts them), the list
  does not claim the radius is empty: it says how many parts could not load and offers to try
  again, and does not offer widening, which would load more of what is failing.
- **R12 — a search with no match offers the nearest names (row 12).** The palette lists up to
  three named summits whose folded names are at least 75% similar (`nearestNames`), as buttons;
  under that it offers none. Unnamed entries are never offered. A no-match keystroke costs about
  26 ms over the 19k names (folding memoised, edit distance bounded and stopped early).
- **R13 — an unnamed summit invites a name (row 13).** Under the title of any summit named
  "Unnamed …", a line says no one has given it a name we know of yet, and "Name this summit"
  opens the prefilled suggestion of specs 28/29.
- **R14 — offline is said, and only what the cache holds is promised (row 14).** A note says the
  app is offline, that areas already opened on this device still show their peaks, and that
  anything new, photos, weather and the map background need a connection. It reads
  `navigator.onLine` at mount, because an installed app can open already offline with no
  `offline` event; it clears on `online`. It does not mention area downloads, which spec 43 §D
  has not built.
- **R15 — the console says where things come from, once (row 15).** `src/lib/greeting.ts` logs
  one `console.info` naming the open data and the repository, with no counts that could
  disagree with what loaded; the app logs nothing else on load.

- **R16 — "Been there" (row 19), approved with the instruction to finish spec 44.** A toggle
  under a trek's title ticks it as climbed, on this device only: `src/lib/climbed.ts` keeps id →
  the day first ticked in `localStorage`, with no account, no server and nothing shared. Every
  read and write is guarded: missing, blocked, full or corrupt storage reads as nothing climbed,
  and a write that was not kept says "Couldn't save that on this device" instead of pretending.
  Re-ticking keeps the first day. The tick celebrates in answer to the press (600 ms, on the named
  allow-list, stilled under reduced motion) with a 20 ms vibration where motion is not reduced;
  reopening a ticked peak shows it ticked without the celebration. "Peaks I've been to" filters
  the list and map to the ticked peaks, carried in the URL as `mine=1`.

- **R17 — a trek's link shows that trek (row 3).** Curated pages and the top 100 hidden gems
  get their own social card, typographic and built only from the record's fields (D1); every
  other page, and any name in a script the card font lacks, keeps the global card. Specified in
  spec 35 §E.

## Constraints learned in review — for the requirements still to be written

Not requirements. These are facts about today's code that review established, recorded so the PR
that specifies each piece starts from them.

- **Focus (row 1).**
  - The skip link focuses `#results`, and Enter on a result focuses the detail panel. So a
    `tabIndex={-1}` container can still be reached from the keyboard.
  - A component's own `focus:outline-none` beats a global `:focus-visible` rule on specificity,
    so each site has to be changed.
  - The panel and sheet focus themselves on mount (`useDialogFocus.ts:34`), so a deep-linked
    selection would draw a ring on load.
  - On mobile, the background is inert while a sheet is open, so moving focus away from the
    sheet breaks Escape and the focus trap.
- **Print (row 2).** Playwright's `emulateMedia({ media: "print" })` never fires `beforeprint`. A
  static page runs no JS (spec 35), so it can say "Built on &lt;date&gt;" but not a print date.
- **Size (row 4).**
  - Measure apparent size (`find -printf %s`), not `du`'s block count.
  - Fonts are separate from JS+CSS, and row 18 will add some.
  - Allow headroom so small PRs do not each have to raise the budget, and reconcile that with
    ratcheting down.
- **Motion (rows 5, 6, 8).**
  - Sheets mount when they open, so a sheet's mount is usually a press.
  - The sheet sets its transition and transform in one effect (`Sheet.tsx:82-84`), so whether it
    animates depends on a style flush.
  - Leaflet's drag inertia, zoom, fade and marker animations ignore stylesheets.
  - `FitToResults` (`TrekMap.tsx:155`) already moves the map, so a fly-to must replace that, not
    compete with it.
  - The default e2e context forces reduced motion. The loading skeletons pulsed during a `?sel=`
    load; they are now still, and `e2e/delight.spec.ts` asserts the browser runs no looping or
    over-300 ms animation after such a load.
  - A transition can be assigned as an expression, not only as a string literal.
- **Set-pieces (rows 7–9).**
  - **Sunrise:** use the sun's centre at −0.833° and no elevation dip; show times in IST (the
    data spans 6.8–36.0° N, 68.2–97.4° E).
  - **Climate:** all 120,441 records have a climate cell, and 254 have no dry month.
    `driestMonths` returns `[]` both for "no dry month" and for malformed input.
  - **Region stats:** `regionStats` summarises the filtered set.
  - **Unnamed names:** names include `Unnamed peak (~…)`, `Unnamed hill (~… m)` (31,774) and
    `Unnamed Peak` (732), and none may lead a sentence.
- **Blank moments (rows 10–15).**
  - **404:** `vite preview` never serves `404.html`. `public/` is copied verbatim, so a tested
    matcher needs a Vite input. The worker serves `data/` stale-while-revalidate.
  - **Empty list:** an empty list after a failed cell load is not proof of an empty radius.
  - **Clear filters:** it resets the radius too.
  - **Console:** `stubApis` aborts hosts, and Chromium logs every abort.
  - **Offline:** an installed app can open already offline, with no `offline` event.

## Edge cases / failure modes

- **A page with no JSON-LD or no canonical.** It fails with the missing piece named, rather than
  being skipped.
- **A slug that equals the id** (71 pages today: 15 curated, 56 generated `osm` pages whose name
  has no ASCII letters). These cannot show this defect, so the build never puts them in the
  sample.
- **A dataset with no page of some kind.** The build logs a warning naming the kind, and the
  sample has no page of it. If **no** page qualifies, the build refuses (R1), so a deploy never
  ships an empty sample.

## Out of scope / not done

- **Sound,** for the reason in the five rules.
- **Bulk basemap downloading,** which the tile providers' terms forbid (spec 43 §D).
- **Trail duration and "start by" times.** No record carries `durationHrs` (0 of 120,441), so any
  such number would be invented (D1).

## Verification

```sh
npx vitest run src/lib/seo.test.ts                  # R1: trekJsonLd uses the url it is given
npx vitest run scripts/lib/trekPage.test.ts         # R1: slug ≠ id, JSON-LD url == canonical
npx vitest run scripts/build-pages.test.ts scripts/build-pages.jsonld.test.ts  # R1: wiring, and the refusal
npm run build:pages                                 # R1 on every real page (refuses on a defect)
npx vitest run scripts/lib/deploycheck.test.ts scripts/check-deploy.test.ts  # R1 live check
npm run e2e:static                                  # R1 on the sampled pages, as served
npm run check:deploy                                # R1 against the live site, after deploy
npx vitest run scripts/check-size.test.ts           # R2: categories, verdicts, refusals
npm run build && npm run check:size                 # R2 on the real build
npx vitest run src/lib/motion.test.ts src/motion.contract.test.ts  # R3, R4 by source and helper
npx playwright test e2e/delight.spec.ts             # R3, R4 in a browser, with motion allowed
npx vitest run src/lib/coords.test.ts scripts/lib/trekPage.test.ts  # R5: DMS, the static card
npx vitest run src/components/TrekDetail.test.tsx  # R5: the app's print block and its date
npx playwright test e2e/print.spec.ts              # R5: the app under print emulation
npm run e2e:static                                 # R5: a static page under print emulation

npx vitest run src/lib/sun.test.ts                  # R6: against the USNO fixture
npx vitest run src/lib/voice.test.ts                # R6–R8: sentences, sparse records
npx vitest run src/components/TrekDetail.test.tsx src/App.test.tsx  # R6–R8 rendered

npx vitest run src/notFound.test.ts src/notFoundMain.test.ts src/lib/nearest.test.ts  # R10, R12
npx vitest run src/lib/cells.test.ts src/components/TrekList.test.tsx   # R11
npx vitest run src/components/CommandPalette.test.tsx src/components/TrekDetail.test.tsx  # R12, R13
npx vitest run src/components/OfflineNote.test.tsx src/lib/greeting.test.ts  # R14, R15
npx playwright test e2e/blank.spec.ts && npm run e2e:static  # R10, R11, R14, R15 in a browser

npx vitest run src/lib/climbed.test.ts src/lib/filters.test.ts src/lib/urlState.test.ts  # R16
npx vitest run src/components/TrekDetail.test.tsx    # R16: the toggle, its date, its failure
npx playwright test e2e/delight.spec.ts              # R16: survives a reload, the filter finds it

npx vitest run scripts/lib/socialCard.test.ts scripts/build-pages.test.ts  # R17
```

## Revisions

| Date       | Change                                                                                                                                                                                                                                   | Covered by                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-10 | Written with the five rules, a register of 20 surfaces, and R1 with its fix. A first draft (PR #76, closed) specified every phase ahead of the code and did not converge in nine review rounds; later requirements land with their code. | `seo.test.ts`, `trekPage.test.ts`, `build-pages.test.ts`, `build-pages.jsonld.test.ts`, `deploycheck.test.ts`, `check-deploy.test.ts` |

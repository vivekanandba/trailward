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
| 1   | Focus                              | `focus-visible` is styled only in `ui/Button.tsx`; seven places set `outline-none`, and five of them add no replacement                                                                                                                                                        | later                                                       |
| 2   | Print                              | No `@media print` anywhere                                                                                                                                                                                                                                                     | later                                                       |
| 3   | Social card                        | One global `icons/og.png` for every page                                                                                                                                                                                                                                       | later; waits for row 18                                     |
| 4   | Size                               | No size budget. JS+CSS in `dist/assets` is 674,629 bytes, of 764,229 with fonts                                                                                                                                                                                                | later; before any other delight                             |
| 5   | Theme toggle                       | Hard icon swap                                                                                                                                                                                                                                                                 | later                                                       |
| 6   | Motion on load                     | A `?sel=` deep link mounts the panel with `.panel-enter` (`App.tsx:84`); the mobile sheet slides on mount (`Sheet.tsx:91`); `FitToResults` animates on mount (`TrekMap.tsx:169`)                                                                                               | later                                                       |
| 7   | Sparse peak detail                 | Numbers only for nearly all 120k records                                                                                                                                                                                                                                       | later                                                       |
| 8   | Origin change                      | The map jumps                                                                                                                                                                                                                                                                  | later                                                       |
| 9   | Region stats card                  | Accurate, reads like a dashboard                                                                                                                                                                                                                                               | later                                                       |
| 10  | 404                                | `public/404.html` redirects to the app root and **drops the path**                                                                                                                                                                                                             | later; waits for row 17                                     |
| 11  | Empty result list                  | Advises "try widening the radius", with no control that does it                                                                                                                                                                                                                | later                                                       |
| 12  | Palette with no matches            | A status message only                                                                                                                                                                                                                                                          | later                                                       |
| 13  | Unnamed peak                       | The label `Unnamed peak`; naming actions exist further down (specs 28/29)                                                                                                                                                                                                      | later                                                       |
| 14  | Offline                            | Nothing says so                                                                                                                                                                                                                                                                | later                                                       |
| 15  | Console                            | Silent                                                                                                                                                                                                                                                                         | later                                                       |
| 16  | Distance from a non-default origin | All **16** curated treks carry a road distance _from Bengaluru_ (`distanceKm`), and the filter, map popup and detail prefer it whatever the origin (`filters.ts:37`, `TrekMap.tsx:193`, `TrekDetail.tsx:268`). From Mysuru, Skandagiri is listed at 67.6 km; it is 176 km away | **defect, own PR** (spec 05)                                |
| 17  | Page URLs are not stable           | 456 pages carry a `-<id>` suffix, 438 of them with `d12-` ids that change when the terrain scan reruns, so those URLs die silently. Sorting by id is not a fix: it would move 322 live URLs                                                                                    | **defect, own PR** (spec 35)                                |
| 18  | Diacritics in names                | The bundled Inter and Bricolage woff2 are Latin-only subsets with no `ā`, `ī` or `ū` (checked with fontTools); 1,944 of the 3,886 page names use a character above U+00FF, so those letters render in a fallback font mid-word                                                 | later                                                       |
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
  - The default e2e context forces reduced motion, and loading skeletons pulse during a `?sel=`
    load.
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
```

## Revisions

| Date       | Change                                                                                                                                                                                                                                   | Covered by                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-10 | Written with the five rules, a register of 20 surfaces, and R1 with its fix. A first draft (PR #76, closed) specified every phase ahead of the code and did not converge in nine review rounds; later requirements land with their code. | `seo.test.ts`, `trekPage.test.ts`, `build-pages.test.ts`, `build-pages.jsonld.test.ts`, `deploycheck.test.ts`, `check-deploy.test.ts` |

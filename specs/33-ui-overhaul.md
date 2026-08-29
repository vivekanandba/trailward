# 33 — UI/UX overhaul: primitives, map-first mobile, honest overlays, visual regression

## Purpose

Execute the parts of spec 08's contract that were never built, fixing the reported symptom
cluster: clicks that appear to do nothing, overlays that don't separate from the busy terrain
basemap, stale content visible during loads, and a mobile layout that buries results below a
map slab and ten always-open filter controls. Four phases, each its own PR; a Playwright
screenshot suite locks the finished UI against regression.

## User stories

- A phone user sees a full-height map with results in a draggable bottom sheet; filters are one
  tap away and never bury the list.
- A desktop user opening a trek sees the panel slide in over a dimmed map — clearly a layer —
  while the list and other pins stay clickable.
- A keyboard/screen-reader user gets truthful semantics: modal sheets trap focus and set
  `aria-modal`; the deliberately non-modal desktop panel doesn't claim otherwise.
- A maintainer changing CSS gets a CI diff image, not a bug report, when a state shifts.

## Acceptance criteria

- **Clicks always answer.** Cluster markers display their member count; clicking one either
  zooms in or (when zooming would be a visual no-op) opens the best member. Pin tap targets are
  ≥ 32 px drawn + Leaflet tap tolerance (`HIT_RADIUS_PX`); selecting a pin pans it into view,
  halos it, and scrolls its list row into view (`aria-current`).
- **Overlays are layers.** Every modal surface mounts over a Scrim (`bg-black/30` +
  `backdrop-blur`); the desktop detail panel slides in (~200 ms) over a non-blocking visual
  scrim on the map pane only — clicking another pin still switches the detail. All transitions
  collapse under `prefers-reduced-motion`.
- **Nothing stale.** Loading shows skeleton rows in place of results (never mixed with them);
  the stats card/banner keep their space. Search input debounced ≤ 200 ms.
- **Mobile is map-first.** Full-height map; results sheet with snap points ~[0.25, 0.55, 0.92]
  dvh draggable from its handle only; filters in a modal sheet behind a badge-counted button;
  detail in a modal sheet opening at half.
- **State is shareable.** `hiddenGemsOnly`/`namedOnly`/`minReliefM` round-trip through the URL
  (`hg`/`nm`/`mr`).
- **One palette.** Map pins, legend, and badges all derive from `DIFFICULTY_COLORS`; a unit
  test pins the tailwind literals to it. Fonts declared in tailwind.config are actually loaded
  (self-hosted fontsource); no emoji glyphs anywhere in chrome (inline SVG icons).
- **Implausible detected pins are gone.** `isPlausibleSummit`: meanSlopeDeg ≤ 60, reliefM
  ≤ 2500, reliefM ≤ elevationM + 430; detected pins whose dominant cover samples Water are
  dropped at the landcover bake. Enforced at detection output, at snapshot load
  (`scripts/sources/detected.ts` — so the cron self-heals without a rescan), and pruned from
  the committed snapshot.
- **Visual gate.** ~8 canonical states (desktop/mobile × light/dark × list/detail/filters/
  empty) as committed linux baselines, diffed in the existing e2e CI job with
  `maxDiffPixelRatio: 0.01`; tiles and third-party APIs stubbed deterministic; diff artifacts
  uploaded on failure.

## Interfaces & data contracts

- `ui/Button` (primary/secondary/ghost; min-h 44 px touch), `ui/IconButton` (44×44, required
  `aria-label`), `ui/Badge`, `ui/Card`, `ui/Scrim { onClick?, pointerEvents?, className? }`.
- `ui/Sheet { snapPoints?, snap, onSnapChange, modal?, onClose?, labelledBy, children }` —
  zero-dep; transform-positioned; drag only from the 44 px handle (pointer capture, velocity
  fling, below-min closes); content scrolls natively.
- `Panel { modal?: boolean }` + `lib/useDialogFocus(ref, { trap, onClose })`: autofocus,
  Escape, focus-restore always; Tab-trap and `aria-modal` only when modal.
- `lib/useMediaQuery(query)` — returns desktop when `matchMedia` is absent (jsdom).
- Z-scale: Leaflet panes ≤ 700, Leaflet controls 800–1000, map overlays (legend/basemap
  toggle) 500, scrim 1190, sheets/panels 1200.
- Icons: `components/icons.tsx`, inline SVG, `currentColor`, no dependency.

## Edge cases & error states

- `prefers-reduced-motion`: all transforms/fades collapse to instant.
- iOS `dvh`/address-bar: sheet heights in dvh; map `InvalidateOnResize` already handles tile
  reflow. Real-device pass required before calling phase 3 done.
- jsdom: no `matchMedia` → desktop branch renders (unit tests stay green).
- Back button: detail sheet participates in history exactly as the panel does today.
- A map-selected pin beyond the 300-row list cap has no row to scroll to — accepted; the
  detail still opens.
- Filter changes that exclude the selection still auto-close the detail (spec 15 behaviour).

## Test cases (TDD checklist)

- Unit: `isPlausibleSummit` with the real corrupt record (relief 5,748, slope 85.5°, Water);
  snap-target maths of Sheet as a pure function; `useDialogFocus` trap on/off; urlState
  round-trip for `hg`/`nm`/`mr` incl. garbage; palette-sync (tailwind literals ===
  `DIFFICULTY_COLORS`); debounce behaviour of the search input.
- E2E (updates): mobile smoke tests gain an open-filters/expand-sheet helper; legend assertion
  becomes count-row regex; Panel tests split modal/non-modal; App test gains a matchMedia-
  mocked mobile variant.
- Visual: `e2e/visual.spec.ts` — 6 states × 2 projects = 12 committed linux baselines
  (`e2e/__screenshots__/`), deterministic stubs (flat committed tiles, fixed weather, aborted
  enrichment hosts), linux-only skip guard, `e2e:update` npm script, `maxDiffPixelRatio: 0.01`,
  `contextOptions.reducedMotion` suite-wide; CI uploads `test-results/` on every outcome.
  Gate proven: a one-line cluster-colour change fails at 3% diff; two consecutive clean runs
  pass byte-identical.

## Out of scope

Spiderfying clusters, marker/list virtualization, PWA/offline polish, any new runtime
dependency for the sheet.

## Open questions

- Dark-mode flat tile vs single grey for the visual stubs (start grey; revisit if dark diffs
  are noisy).
- Whether legend counts include the unverified row (start: yes, as its own slate row).

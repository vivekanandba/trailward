# 09 — Hosting & Deploy

## Purpose

Ship Trailward to **GitHub Pages** for free, with a CI pipeline that **only publishes when data
validates and all tests pass**.

## User stories

- As the **maintainer**, I want `git push` to deploy automatically when everything is green.
- As the **maintainer**, I want broken data or failing tests to **block** publishing.
- As a **friend**, I want a simple public URL that works on my phone.

## Acceptance criteria

- **Given** a push to `main`, **when** CI runs, **then** jobs `validate-data`, `test` (typecheck +
  unit), and `e2e` run; the `build` + `deploy` jobs run **only if all three pass**.
- **Given** the build, **when** assets are emitted, **then** Vite `base: '/trailward/'` makes JS,
  CSS, and Leaflet marker images resolve at `https://<user>.github.io/trailward/`.
- **Given** a deep link is refreshed on Pages, **when** there's no server route, **then** the app
  still loads (hash routing or `404.html` fallback) — no hard 404.
- **Given** a maintainer adds a custom domain later, **when** `base` is set to `'/'`, **then** the
  app works at the domain root.

## Interfaces & data contracts

- `.github/workflows/deploy.yml`:
  - `validate-data`: `npm ci && npm run validate:data`
  - `test`: `npm ci && npm run typecheck && npm test`
  - `e2e`: `npm ci && npx playwright install --with-deps chromium && npm run e2e -- --project=chromium`
  - `build`: `needs: [validate-data, test, e2e]` → `npm run build` → upload Pages artifact
  - `deploy`: `needs: build` → `actions/deploy-pages`
- Pages source = **GitHub Actions** (set once in repo Settings → Pages).

## Edge cases & error states

- e2e flakiness → Playwright `retries: 2` in CI; still must pass to deploy.
- A red pipeline leaves the previously deployed site live (no partial publish).
- Forks/PRs don't deploy (deploy only on `main` / dispatch).

## Test cases (TDD checklist)

- Local `npm run build` produces `dist/` with asset URLs under `/trailward/` (assert in build
  output / a small script test).
- Deep-link/refresh handling verified by an e2e test (navigate to a filtered URL, reload, app
  loads).
- Workflow lints/parses (actionlint optional) and job `needs` wiring matches this spec.

## Out of scope

- The refresh cron (→ 10). DNS/custom-domain purchase.

## Open questions

- Hash routing vs. `404.html` SPA fallback — pick one (lean: hash routing, simplest on Pages).
- Keep e2e as a hard deploy gate, or make it advisory to avoid flaky blocks? (Lean: hard gate, low
  flakiness expected for this app.)

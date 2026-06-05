# 08 — Design System

## Purpose

Give Trailward a distinctive, production-grade look (not generic-AI) and a small, consistent set of
UI primitives, applied via the `frontend-design` skill. This spec defines the design contract the
polish phase must satisfy.

## User stories

- As a **visitor**, I want the app to feel crafted and trustworthy, and to be fully usable on my
  phone.
- As a **developer**, I want a documented palette, type scale, and component set so the UI stays
  consistent as it grows.

## Acceptance criteria

- **Given** the app, **when** viewed, **then** it uses the defined palette and type scale (no
  default/unstyled look) and difficulty colors are consistent between markers, badges, and detail.
- **Given** a phone viewport (≤ 414 px), **when** used, **then** the map stays usable and
  filters/detail collapse into accessible panels/sheets (no horizontal scroll, tap targets ≥ 44px).
- **Given** interactive elements, **when** focused/hovered, **then** there are clear focus rings
  and hover states; color contrast meets WCAG AA for text.
- **Given** difficulty, **then** Easy/Moderate/Hard map to a fixed, colorblind-friendly trio used
  everywhere.

## Interfaces & data contracts

- **Palette** (Tailwind theme tokens): a nature-leaning primary (`trail`), neutrals, and a fixed
  difficulty triad — finalized during polish, recorded here as tokens + hex.
- **Type scale:** display / h1 / h2 / body / caption with a single heading + body font pairing.
- **Components:** `Badge` (difficulty/type/verified), `Card` (trek), `Panel`/`Sheet` (filters,
  detail), `Slider`, `SearchInput`, `Button`. Each documented with states.
- **Layout:** desktop = map + left filter rail + right detail; mobile = full-map with bottom
  sheet for list/filters/detail.

## Edge cases & error states

- Long trek names wrap without breaking layout.
- Empty/error/loading states have designed treatments (not raw text).
- Dark map tiles vs. light UI — ensure marker/badge contrast on both.

## Test cases (TDD checklist)

- Playwright visual/responsive checks at desktop + mobile breakpoints (no overflow; key controls
  reachable).
- Difficulty token usage is centralized (a single source maps difficulty → color), asserted by a
  unit test so markers/badges can't drift.
- Axe/contrast smoke check on the main view (no critical violations).

## Out of scope

- Final pixel mockups (produced during polish, optionally via Figma). Brand/logo work beyond a
  simple wordmark.

## Open questions

- Want a custom domain + wordmark/logo, or is the text wordmark "Trailward" enough for v1?
- Any color preferences, or shall I derive a trail/forest palette during polish?

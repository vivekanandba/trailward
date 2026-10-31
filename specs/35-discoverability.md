# 35 — Discoverability: canonical URLs, structured data, static trek pages

## Purpose

Trailward holds 120,441 records and exposes **one** indexable URL. Every detected summit, every
name recovered from OSM/Wikidata/inference, every rainfall-derived season and ground-cover
sample is invisible to search engines, because it exists only after JavaScript runs and only
behind query parameters. This spec makes the dataset findable: correct absolute URLs, machine
-readable structured data, and real pre-rendered HTML pages for the treks worth landing on.

## A. URL discipline (the prerequisite)

The app is served from a project path (`/trailward/`), which is the single most common source
of broken canonical/OG URLs on GitHub Pages. Rules:

- One module, `src/lib/seo.ts`, owns every absolute URL. Nothing else builds one by hand.
- `SITE_URL` includes the base path (`https://vivekanandba.github.io/trailward`); the
  `absoluteUrl(path)` helper joins without ever doubling it — `absoluteUrl("/trailward/x")`
  and `absoluteUrl("x")` must both yield `…/trailward/x`.
- Trailing-slash form is canonical for directory-style routes, and identical between
  `<link rel=canonical>` and `og:url` for the same page.
- A regression test asserts the doubled-base-path form (`/trailward/trailward/`) can never be
  produced, because that exact bug shipped in the sibling portfolio project.

## B. Crawl surface

- **`public/robots.txt`** — allows everything and names the sitemap absolutely. It does NOT
  disallow the served cell files, tempting as that is: the app fetches its data from there, and
  a crawler that renders the page with those requests blocked sees an empty map — a worse
  signal than the crawl budget it saves. Crawl priority is steered by the sitemap instead.
- **`public/sitemap.xml`** — generated, never hand-edited (`npm run build:sitemap`, run in the
  same prebuild step as the chunks). Contains the app root plus, once section C lands, every
  static trek page. `lastmod` comes from the data, not from build time, so an unchanged page
  does not claim to have changed.

## C. Static trek pages

A build-time generator (`scripts/build-pages.ts`) emits `dist/t/<slug>/index.html` per
qualifying trek. These are ordinary HTML documents: readable without JavaScript, indexable,
and each carries a prominent link that opens the same trek on the live map
(`/trailward/?sel=<id>` — the existing deep-link contract of spec 30/33).

**Qualification** (quality over volume — a dump of 120k stubs is spam, not coverage):

1. every `tier: "curated"` record; plus
2. every record carrying real prose or media (`summary`/`highlights`, `historicalNote`, or
   `image`); plus
3. the highest-ranked named summits per 1° cell, capped, so coverage is geographically spread
   rather than clustered on Bengaluru.

A record whose name starts with "Unnamed" never qualifies: a page titled "Unnamed peak
(~912 m)" has nothing to rank for and dilutes the rest.

**Each page contains** the trek name and elevation as a real `<h1>`, the fact table the detail
panel shows (difficulty, best season, ground cover, relief/slope/prominence, nearest town),
the historical note when present with its 1908-gazetteer citation, the photo with its required
attribution, source links, and the map deep-link.

## D. Structured data

- App shell: `WebApplication` + `Dataset` JSON-LD — the dataset is the product, and
  `Dataset` with `license`, `creator`, `temporalCoverage` and `distribution` is how a search
  engine understands that.
- Trek page: `Place` with `@type` refined to `TouristAttraction` (`geo` GeoCoordinates
  including `elevation`, `photo`, `isAccessibleForFree`). Only fields the record actually
  carries are emitted — an absent elevation is omitted, never guessed (CON-DATA-001).

## E. Social cards

Per-page link-preview images (spec 44 R17), typographic only, generated at build with no network
access: `scripts/lib/socialCard.ts` lays out the trek's name, then a facts line from the fields
the record holds (elevation, difficulty, marked "est." when terrain-estimated, relief), and
renders 1200×630 PNGs with `@resvg/resvg-js` and a committed DejaVu Sans Bold
(`scripts/cards/`, Bitstream Vera licence). Both are build-time only; nothing ships to a reader
but the PNGs (CON-SEC-003: a build-tree dependency, audited as one).

- **Which pages:** every curated page and the top 100 by hidden-gem score, about 116 cards and
  4 MB per build. Every other page keeps the global card (`icons/og.png`). Carding all 3,886
  would be about 140 MB of images for crawlers alone.
- **Which names:** only Latin and Latin Extended, which the font covers (ā ī ū ṭ ṇ). A name with
  any other script keeps the global card rather than render boxes.
- **Fit:** the title shrinks from 96 px to 64 px and wraps at a word onto two lines, the second
  cut with "…" if needed; a test measures every carded name's rendered width with resvg itself.
- The page's `og:image` points at its card; cards are written under `dist/t/<slug>/`, so the
  generator's clean rebuild removes a card whose page is gone.

## Edge cases & error states

- Slugs collide (two "Nandi Hills"): the generator appends the record id, and asserts global
  slug uniqueness before writing — a silently overwritten page is a lost page.
- A trek page must not 404 on refresh: these are real files, not SPA routes, so the existing
  `404.html` redirect never sees them.
- Records are scrubbed between builds (spec 33): pages for records that no longer exist are
  removed by cleaning the output directory, so the sitemap can never advertise a dead URL.
- No JavaScript: a trek page is fully readable; the map link is a plain `<a>`.

## Test cases (TDD checklist)

- `absoluteUrl` joins with and without the base path, never doubles it, preserves query and
  hash, and rejects a non-absolute `SITE_URL`.
- `canonicalFor` and the OG url agree for the same input.
- `trekJsonLd` emits `geo.latitude/longitude`, omits absent fields entirely, and never
  fabricates a value.
- `sitemapXml` escapes entities, emits absolute URLs only, and is valid XML.
- `qualifies()` accepts curated/rich/top-ranked and rejects "Unnamed" records.
- `slugFor` is stable, URL-safe, transliterates diacritics, and deduplicates collisions.
- Generator: writes one file per qualifying trek, cleans stale output, refuses on slug
  collision.
- E2E: a generated page returns 200 with the trek name in the served HTML (not injected by
  JS), its canonical is absolute and correct, and its map link deep-links to the app.

## Out of scope

Pages for the ~101k "Unnamed" pins; multilingual pages; any server-side rendering of the app
itself; paid search or submission APIs.

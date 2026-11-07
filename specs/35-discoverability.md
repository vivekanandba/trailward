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

**Where each page lives: the slug registry.** A page's URL is `t/<slug>/`, and the slug is
recorded once in `scripts/pages/slugs.json` (slug → `{id, lat, lng}`) and kept. The registry is
a lockfile:

- `npm run build:slugs` (`scripts/build-slugs.ts`) gives each page with no slug its bare slug
  (`slugFor`, the name folded to ASCII), or `<slug>-<id>` when any record has ever held the bare
  one. It never deletes an entry and never gives a slug to a different peak: a slug whose page
  has gone stays reserved.
- A page whose id is new but which stands within 120 m of a registered record that is **gone
  from the dataset**, **under the same name**, takes over that record's slug. That is a terrain
  rescan regenerating a `d12-` id for the same summit (spec 27). Each registry entry records its
  record's name, folded as its slug folds it (or `~` and the name itself when it has no Latin
  letters, so two different non-Latin names never match), and a live page's entry follows its
  record, so a rename is the name the next rescan matches on. The match is on that recorded name,
  never on the slug's text: a slug keeps re-attaching across any number of rescans whatever id
  suffix it carries, and "Kote" never takes `kote-betta`. When several pages and orphans qualify,
  the nearest pairs are matched first (ties by slug, then id), so build order cannot make two
  same-named neighbours swap URLs. A different name or a farther point is a different page. A
  record still in the dataset keeps its slug while it has no page. A new slug never differs only
  in case from one already held.
- `build-pages` and `build-sitemap` only read the registry, through one function
  (`slugsFromRegistry`), and **refuse to build** when a qualifying page has no slug, when a
  record has two, or when a slug is not URL-safe (letters, digits and single hyphens; upper case
  is allowed, because four live URLs end in a Wikidata id such as `bandarpunch-wd-Q4854459`), or
  when two slugs differ only in case (one directory on a case-insensitive filesystem). The
  message names `npm run build:slugs`. `build:slugs` runs the same check before it writes, so a
  workflow never commits a registry the build refuses, and a malformed registry is refused by
  name.
- Both data workflows (`refresh-data.yml`, `apply-suggestions.yml`) run `build:slugs` and commit
  the registry with the data, so a deploy never meets an unregistered page.
- A record that is renamed keeps its slug: a URL that keeps working beats one that matches the
  new name.
- The first registry was written from the order-dependent rules it replaces, and equals the
  3,886 URLs of the live sitemap on 2026-10-31, so no published URL moved.

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

Per-page Open Graph images generated at build from the trek's own facts (name, elevation,
difficulty, relief), typographic only, no network access at generation time. Deferred to
section C's PR; the app-shell card (`icons/og.png`) already exists.

## Edge cases & error states

- Slugs collide (two "Nandi Hills"): the registry gives the later one `<slug>-<id>`, and the
  generator still asserts global slug uniqueness before writing — a silently overwritten page is
  a lost page.
- **Defect fixed (spec 44 register row 17):** slugs used to be recomputed every build from the
  name and the build order. A page's URL changed when another page of the same name appeared
  earlier in the order, and the 438 pages with a collision suffix on a `d12-` id died whenever a
  rescan regenerated the ids. Sorting by id instead would itself have moved 322 live URLs, which
  is why the fix records URLs rather than computing them.
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
- `scripts/lib/slugs.test.ts`: a registered slug survives a change of build order; a rescanned
  record at the same place with the same name takes over its slug; a different name, a name the
  slug merely starts with, or a point more than 120 m away does not; repeated rescans keep
  re-attaching the same slug; a page with no Latin letters re-attaches on its own name and never
  on another non-Latin name; a page whose id is its slug re-attaches without taking a nameless
  page's URL; each URL goes to its nearest same-named page in either build order; a rename is
  followed; a new slug avoids a case twin; a record still in the
  dataset without a page keeps its slug; a retired slug is never reassigned; a free bare slug is
  used; updating is idempotent; the build refuses an unregistered page, a record with two slugs
  and an unusable slug or a case twin, and accepts an upper-case Wikidata suffix; a malformed
  registry (including an entry with no position, or no recorded name in folded form) is
  refused by name; the first registry equals today's slugs; `runBuildSlugs` bootstraps, only
  adds, and refuses to write a registry the build would refuse; and the committed registry gives
  every page of the committed dataset exactly one usable slug, each entry recording its record's
  name.
- E2E: a generated page returns 200 with the trek name in the served HTML (not injected by
  JS), its canonical is absolute and correct, and its map link deep-links to the app.

## Out of scope

Pages for the ~101k "Unnamed" pins; multilingual pages; any server-side rendering of the app
itself; paid search or submission APIs.

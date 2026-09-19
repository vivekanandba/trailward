# 36 — Content pages: attribution, method, freshness

## Purpose

Two gaps, one mechanism.

**The compliance gap.** Trailward's dataset is assembled from sources whose licences require
attribution: GeoNames (CC-BY 4.0), OpenStreetMap (ODbL), ESA WorldCover (CC-BY 4.0), Wikidata
(CC0, no attribution required but courteous), Wikimedia Commons photos (per-image licences),
Open-Meteo, and Copernicus/Terrarium elevation tiles. Today only the _map tiles_ are
attributed, inline on the map. The data behind 120,441 records is not credited anywhere a
reader can find. That is a licence obligation, not a nicety.

**The discoverability gap.** How the detection works — scanning elevation tiles for local
maxima, the relief tiering, the India mask, why 101k pins remain "Unnamed" — is genuinely
unique material that exists nowhere else on the web, and nothing in the app explains it.

Both are solved by the same thing: a small markdown → HTML pipeline emitting static pages,
reusing the phase-B page machinery.

## Pages

| Route       | Purpose                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `/about/`   | What Trailward is, who it's for, what "unverified" means, how to read a pin                   |
| `/sources/` | **Every data source, its licence, its link, and what it contributes.** The compliance surface |
| `/data/`    | Freshness: record counts by tier, last refresh date, what the drift guard checks              |

Each is a real HTML file (no client JS required), carries canonical/OG metadata via
`src/lib/seo.ts`, and is listed in the sitemap.

## Content pipeline

- Authored as markdown under `content/*.md` with YAML-ish frontmatter (`title`, `description`,
  `updated`).
- Parsed by a **dependency-free** renderer (`scripts/lib/markdown.ts`): this project ships no
  markdown dependency today and the content is a handful of pages of headings, paragraphs,
  lists, links, tables and inline code. A full CommonMark implementation would be a large new
  dependency for a small, controlled corpus.
- A **policy pass that throws at build time**, mirroring the sibling portfolio's approach:
  - every link must be absolute-external (`https://`) or site-relative (`/trailward/…`);
  - external links get `rel="noopener noreferrer"`;
  - an image without alt text fails the build;
  - a page without a `title` or `description` in frontmatter fails the build.
- Output escapes all text by default; raw HTML in markdown is **not** supported (it would be
  the only injection path into a page nobody reviews line-by-line).

## The `/data/` page is generated, not written

Its numbers come from the dataset at build time — total records, counts by tier, named vs
unnamed, how many carry each enrichment field. A hand-written number would be wrong within a
week and there is no reason to trust prose over a count (CON-DATA-001).

## Edge cases & error states

- A markdown file that fails policy fails the **build**, not the page: a live page with a
  broken link is worse than a build that stops.
- `updated` in frontmatter is the content's own date, not the build's, so rebuilding does not
  claim a page changed.
- The pages must render legibly with no JavaScript and in both colour schemes.

## Test cases (TDD checklist)

- Markdown: headings, paragraphs, lists, links, inline code, tables; text is escaped; a raw
  `<script>` in source is rendered inert.
- Policy: rejects a relative link, an `http://` link, an image without alt, missing
  frontmatter title/description — each naming the file and the reason.
- Frontmatter: parses title/description/updated; a missing required key throws.
- `/data/` stats: counts derive from the dataset and match a known fixture.
- E2E (static project): each page returns 200, has a single `h1`, a correct canonical, and
  appears in the sitemap; `/sources/` names GeoNames, OpenStreetMap, ESA WorldCover and their
  licences.

## Out of scope

A blog or field notes (the pipeline would support it; nothing to publish yet), RSS/Atom,
per-page OG image generation (spec 35 §E, still deferred), comments.

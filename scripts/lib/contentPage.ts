/**
 * Static content pages (spec 36) — /about/, /sources/, /data/. Same shape as
 * the trek pages: plain HTML, no client JS, correct canonical/OG metadata.
 */
import type { Frontmatter } from "./markdown";
import { esc } from "./trekPage";
import { absoluteUrl } from "../../src/lib/seo";

const STYLE = `
:root{color-scheme:light dark;--ink:#1c3927;--bg:#f0f7f1;--muted:#4b5f52;--card:#fff;--line:#d9e6dc}
@media(prefers-color-scheme:dark){:root{--ink:#e6eeea;--bg:#0f172a;--muted:#9fb3a6;--card:#1e293b;--line:#334155}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 4rem}
a{color:#2f6b3f}
@media(prefers-color-scheme:dark){a{color:#7fb98c}}
h1{font-size:clamp(1.9rem,5vw,2.6rem);line-height:1.15;margin:.2em 0 .4em}
h2{margin-top:2.2rem;font-size:1.3rem}
h3{margin-top:1.6rem;font-size:1.05rem}
.sub{color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:1.2rem 0;font-size:.93rem}
th,td{text-align:left;padding:.55rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
code{background:var(--card);border:1px solid var(--line);border-radius:.3rem;padding:.1rem .35rem;font-size:.9em}
img{max-width:100%;height:auto}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.85rem;color:var(--muted)}
`.trim();

export function renderContentPage(data: Frontmatter, bodyHtml: string, slug: string): string {
  const canonical = absoluteUrl(`${slug}/`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(data.title)} — Trailward</title>
    <meta name="description" content="${esc(data.description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="/trailward/icon.svg" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${esc(data.title)} — Trailward" />
    <meta property="og:description" content="${esc(data.description)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:image" content="${esc(absoluteUrl("icons/og.png"))}" />
    <meta name="twitter:card" content="summary_large_image" />
    <style>${STYLE}</style>
  </head>
  <body>
    <main class="wrap">
      <p class="sub"><a href="/trailward/">← Trailward</a></p>
      ${bodyHtml}
      <footer>
        <p>
          <a href="/trailward/">Map</a> · <a href="/trailward/about/">About</a> ·
          <a href="/trailward/sources/">Sources</a> · <a href="/trailward/data/">Data</a>
          ${data.updated ? `<br />Updated ${esc(data.updated)}.` : ""}
        </p>
      </footer>
    </main>
  </body>
</html>
`;
}

/** The /data/ page body is GENERATED: a hand-written count is wrong in a week. */
export interface DatasetStats {
  total: number;
  curated: number;
  named: number;
  unnamed: number;
  withSeason: number;
  withCover: number;
  pages: number;
}

export function datasetStats(
  treks: { name: string; tier: string; bestSeason?: string; landCover?: string }[],
  pages: number,
): DatasetStats {
  const named = treks.filter((t) => !t.name.startsWith("Unnamed")).length;
  return {
    total: treks.length,
    curated: treks.filter((t) => t.tier === "curated").length,
    named,
    unnamed: treks.length - named,
    withSeason: treks.filter((t) => t.bestSeason !== undefined).length,
    withCover: treks.filter((t) => t.landCover !== undefined).length,
    pages,
  };
}

const n = (v: number): string => v.toLocaleString("en-IN");

export function dataPageMarkdown(stats: DatasetStats, refreshed?: string): string {
  return `# The dataset

Trailward ships its data as static files, rebuilt and committed rather than queried live.
These figures are generated at build time from the dataset itself — nothing here is typed by
hand, because a hand-written count is wrong within a week.

| | Records |
| --- | --- |
| Total summits | ${n(stats.total)} |
| Named | ${n(stats.named)} |
| Still unnamed | ${n(stats.unnamed)} |
| Hand-curated treks | ${n(stats.curated)} |
| With a best season | ${n(stats.withSeason)} |
| With ground cover | ${n(stats.withCover)} |
| With their own page | ${n(stats.pages)} |

${refreshed ? `The dataset was last rebuilt on **${refreshed}**.` : ""}

## How it stays honest

A weekly job rebuilds the discovery layers from their committed sources. Before it is allowed
to commit anything, a drift guard compares every enrichment count against the previous
dataset and **fails the run** if any of them drops by more than a small tolerance. That check
exists because a rebuild once succeeded while silently stripping ground cover from more than a
hundred thousand records.

Records that are physically implausible — a mean slope above 60 degrees, relief exceeding the
summit's own height, a "peak" standing in open water — are removed by a plausibility gate at
three separate points in the pipeline, so a corrupt elevation sample cannot reappear.

## Reuse

The aggregate dataset is offered under the ODbL; see [sources](/trailward/sources/) for the
full list of inputs and their licences.
`;
}

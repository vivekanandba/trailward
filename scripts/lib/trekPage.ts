/**
 * One static trek page (spec 35 §C). Plain HTML, no framework, no client JS:
 * a crawler and a reader on a dead signal both get the full facts, and the
 * page links into the live map via the deep-link contract of spec 30/33.
 *
 * Styling is a small inline stylesheet rather than the app bundle — these
 * pages must render standalone, and shipping 600 KB of React to show a fact
 * table would be absurd.
 */
import type { Trek } from "../../src/lib/trek";
import { absoluteUrl, jsonLdScript, trekJsonLd } from "../../src/lib/seo";

/** Every user-facing string passes through here: a name is untrusted input. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root{color-scheme:light dark;--ink:#1c3927;--bg:#f0f7f1;--muted:#4b5f52;--card:#fff;--line:#d9e6dc}
@media(prefers-color-scheme:dark){:root{--ink:#e6eeea;--bg:#0f172a;--muted:#9fb3a6;--card:#1e293b;--line:#334155}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 4rem}
a{color:inherit}
h1{font-size:clamp(1.8rem,5vw,2.6rem);line-height:1.15;margin:.2em 0 .1em}
.sub{color:var(--muted);margin:0 0 1.5rem}
.cta{display:inline-block;background:#2f6b3f;color:#fff;text-decoration:none;padding:.7rem 1.1rem;border-radius:.6rem;font-weight:600}
table{width:100%;border-collapse:collapse;margin:1.5rem 0}
th,td{text-align:left;padding:.55rem 0;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:500;color:var(--muted);width:45%}
td{text-align:right}
figure{margin:1.5rem 0}
img{width:100%;height:auto;border-radius:.6rem;display:block}
figcaption,.note cite{font-size:.8rem;color:var(--muted)}
.note{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:1rem;margin:1.5rem 0}
.note p{margin:0 0 .5rem}
footer{margin-top:3rem;font-size:.85rem;color:var(--muted)}
ul{padding-left:1.1rem}
`.trim();

/** A fact row, omitted entirely when the record lacks the fact. `false` is
 *  accepted so call sites can guard inline; 0 is a real value and is kept. */
const row = (label: string, value?: string | number | false): string =>
  value === undefined || value === false || value === ""
    ? ""
    : `<tr><th>${esc(label)}</th><td>${esc(String(value))}</td></tr>`;

export function renderTrekPage(trek: Trek, slug: string): string {
  const canonical = absoluteUrl(`t/${slug}/`);
  const kind = trek.difficulty ?? trek.estimatedDifficulty;
  const title = `${trek.name}${trek.elevationM ? ` (${trek.elevationM} m)` : ""} — Trailward`;
  const description =
    trek.highlights ??
    trek.historicalNote?.text ??
    `${trek.name} — a summit in India${trek.nearestTown ? `, near ${trek.nearestTown}` : ""}${
      trek.elevationM ? `, ${trek.elevationM} m` : ""
    }. Terrain, best season and directions on Trailward.`;

  const facts = [
    row("Elevation", trek.elevationM !== undefined && `${trek.elevationM} m`),
    row("Difficulty", kind !== undefined && (trek.difficulty ? kind : `${kind} (estimated)`)),
    row("Type", trek.type?.join(", ")),
    row("Best season", trek.bestSeason),
    row("Nearest town", trek.nearestTown),
    row("Ground cover", trek.landCover),
    row("Local relief", trek.reliefM !== undefined && `${trek.reliefM} m`),
    row("Mean slope", trek.meanSlopeDeg !== undefined && `${trek.meanSlopeDeg}°`),
    row("Night trek", trek.nightTrek === true && "Popular"),
    row("Coordinates", `${trek.lat.toFixed(4)}, ${trek.lng.toFixed(4)}`),
  ]
    .filter(Boolean)
    .join("\n      ");

  const photo = trek.image?.url
    ? `<figure>
        <img src="${esc(trek.image.url)}" alt="${esc(trek.name)}" loading="lazy" />
        <figcaption>${esc(trek.image.attribution ?? "")}</figcaption>
      </figure>`
    : "";

  const note = trek.historicalNote
    ? `<div class="note">
        <p>${esc(trek.historicalNote.text)}</p>
        <cite>— ${esc(trek.historicalNote.source)}${
          trek.historicalNote.year ? `, ${trek.historicalNote.year}` : ""
        }</cite>
      </div>`
    : "";

  const sources = trek.sources?.length
    ? `<h2>Sources</h2>
      <ul>${trek.sources
        .map((s) => `<li><a href="${esc(s)}" rel="noopener noreferrer nofollow">${esc(s)}</a></li>`)
        .join("")}</ul>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description.slice(0, 300))}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="/trailward/icon.svg" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description.slice(0, 300))}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:image" content="${esc(absoluteUrl("icons/og.png"))}" />
    <meta name="twitter:card" content="summary_large_image" />
    <style>${STYLE}</style>
    <script type="application/ld+json">${jsonLdScript(trekJsonLd(trek))}</script>
  </head>
  <body>
    <main class="wrap">
      <p class="sub"><a href="/trailward/">← Trailward</a></p>
      <h1>${esc(trek.name)}</h1>
      <p class="sub">${esc(description)}</p>
      <p><a class="cta" href="/trailward/?sel=${esc(trek.id)}">Open on the map →</a></p>
      ${photo}
      <table>
      ${facts}
      </table>
      ${note}
      ${sources}
      <footer>
        <p>
          Facts are computed from open data (GeoNames, OpenStreetMap, ESA WorldCover,
          Open-Meteo, Copernicus elevation tiles) and are <strong>unverified</strong> unless
          marked otherwise. Check conditions locally before you set out.
        </p>
      </footer>
    </main>
  </body>
</html>
`;
}

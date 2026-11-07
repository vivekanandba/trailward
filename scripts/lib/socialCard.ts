/**
 * Per-trek social cards (spec 35 §E, spec 44 R17): the image a link preview
 * shows, typographic only, every word from a field the record holds (D1).
 *
 * Rendered at build time with resvg (a dev dependency that never ships) and a
 * committed DejaVu Sans Bold, so the card looks the same on every machine and
 * covers Latin and Latin Extended (ā ī ū ṭ ṇ). A name with any other script is
 * not carded: it keeps the global card rather than draw boxes for glyphs the
 * font lacks.
 */
import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../../src/lib/trek";

const FONT = resolve(dirname(fileURLToPath(import.meta.url)), "../cards/DejaVuSans-Bold.ttf");
const W = 1200;
const H = 630;

const xml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Latin, Latin-1, Latin Extended-A/B, IPA-free combining marks, Latin Extended Additional. */
export function canRender(name: string): boolean {
  return [...name.normalize("NFC")].every((ch) => {
    const cp = ch.codePointAt(0)!;
    // Control and invisible formatting characters are not drawable: a
    // vertical tab would make the SVG invalid and fail the whole build.
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return false;
    if ((cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e)) return false;
    if (cp >= 0x2060 && cp <= 0x206f) return false;
    return (
      cp <= 0x24f ||
      (cp >= 0x300 && cp <= 0x36f) ||
      (cp >= 0x1e00 && cp <= 0x1eff) ||
      (cp >= 0x2000 && cp <= 0x206f)
    );
  });
}

// The title's room: the card is 1200 px wide with an 80 px margin each side.
const TITLE_ROOM = 1040;
// DejaVu Sans Bold's average advance, measured with resvg: 0.651 em per
// character on a mixed-case name; 0.68 leaves room for wider letters.
const EM_PER_CHAR = 0.68;

/**
 * At most two lines broken at spaces, or undefined when the name does not fit
 * in two lines of `perLine` characters (a word too long for a line, or a
 * third line needed).
 */
function wrap(name: string, perLine: number): string[] | undefined {
  const lines: string[] = [];
  let line = "";
  for (const w of name.split(/\s+/)) {
    if (w.length > perLine) return undefined;
    if (!line) line = w;
    else if ((line + " " + w).length <= perLine) line = `${line} ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  lines.push(line);
  return lines.length <= 2 ? lines : undefined;
}

/** Two lines at 64 px, the second cut at a word with "…": shorter, never different. */
function cut(name: string, perLine: number): string[] {
  const words = name.split(/\s+/);
  const first: string[] = [];
  while (words.length && [...first, words[0]].join(" ").length <= perLine)
    first.push(words.shift()!);
  if (first.length === 0) first.push(words.shift()!.slice(0, perLine - 1) + "…");
  let second = words.join(" ");
  if (second.length > perLine) {
    const head = second.slice(0, perLine - 1);
    const at = head.lastIndexOf(" ");
    second = `${at > 0 ? head.slice(0, at) : head}…`;
  }
  return second ? [first.join(" "), second] : [first.join(" ")];
}

/**
 * Lines and font size for a title: the largest of 96, 84, 72 and 64 px at
 * which the whole name fits in two lines; only when none does is it cut, at
 * 64 px (spec 35 §E).
 */
export function titleLayout(name: string): { lines: string[]; size: number } {
  const fits = (size: number) => Math.floor(TITLE_ROOM / (size * EM_PER_CHAR));
  for (const size of [96, 84, 72, 64]) {
    const lines = wrap(name, fits(size));
    if (lines) return { lines, size };
  }
  return { lines: cut(name, fits(64)), size: 64 };
}

/** The facts line, from fields the record holds; empty when it holds none. */
function facts(t: Trek): string {
  const kind =
    t.difficulty ?? (t.estimatedDifficulty ? `est. ${t.estimatedDifficulty}` : undefined);
  return [
    t.elevationM !== undefined ? `${t.elevationM} m` : undefined,
    kind,
    t.reliefM !== undefined ? `${t.reliefM} m relief` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The card's SVG, or undefined when the name has glyphs the font lacks. */
export function cardSvg(t: Trek): string | undefined {
  if (!canRender(t.name)) return undefined;
  const { lines, size } = titleLayout(t.name);
  const top = lines.length === 1 ? 300 : 250;
  const title = lines
    .map((l, i) => `<tspan x="80" y="${top + i * size * 1.1}">${xml(l)}</tspan>`)
    .join("");
  const line2 = facts(t);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#1c3927"/>` +
    `<path d="M0 ${H} L360 330 L560 470 L760 300 L1200 ${H} Z" fill="#2f6b3f" opacity="0.55"/>` +
    `<text font-family="DejaVu Sans" font-weight="bold" font-size="${size}" fill="#ffffff">${title}</text>` +
    (line2
      ? `<text x="80" y="${top + lines.length * size * 1.1 + 20}" font-family="DejaVu Sans" font-size="40" fill="#bcdcc4">${xml(line2)}</text>`
      : "") +
    `<text x="80" y="570" font-family="DejaVu Sans" font-size="32" fill="#90c2a0">Trailward · summits across India, from open data</text>` +
    `</svg>`
  );
}

/** Every curated page, then the top `topN` by hidden-gem score; only renderable names. */
export function cardPages(pages: Trek[], topN = 100): Trek[] {
  const ok = pages.filter((p) => canRender(p.name));
  const curated = ok.filter((p) => p.tier === "curated");
  const gems = ok
    .filter((p) => p.tier !== "curated" && p.discoveryScore !== undefined)
    .sort((a, b) => b.discoveryScore! - a.discoveryScore! || a.id.localeCompare(b.id))
    .slice(0, topN);
  return [...curated, ...gems];
}

export function renderCard(svg: string): Uint8Array {
  return new Resvg(svg, {
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" },
  })
    .render()
    .asPng();
}

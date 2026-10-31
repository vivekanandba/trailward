import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwind from "../tailwind.config";

// Spec 08 / spec 44 register row 18. The bundled fonts were Latin-only, and
// 1,944 of 3,886 page names use a letter above U+00FF (Kumāra, Bhīma), so
// those letters rendered in a fallback font mid-word.
const css = readFileSync(resolve(__dirname, "index.css"), "utf8");
// Read, not imported: vite's transform of the 40 MB dataset times out under load.
const treks = JSON.parse(readFileSync(resolve(__dirname, "data/treks.json"), "utf8")) as {
  name: string;
}[];

interface Face {
  family: string;
  src: string;
  ranges: [number, number][];
}

const faces: Face[] = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
  const family = body.match(/font-family:\s*"([^"]+)"/)![1];
  const src = body.match(/url\("\.\/([^"]+)"\)/)![1];
  const range = body.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
  const ranges = range
    .split(",")
    .map((r) => r.trim().replace(/^U\+/i, ""))
    .filter(Boolean)
    .map((r) => {
      const [a, b] = r.split("-");
      return [parseInt(a, 16), parseInt(b ?? a, 16)] as [number, number];
    });
  return { family, src, ranges };
});

const covers = (family: string, cp: number): boolean =>
  faces.some((f) => f.family === family && f.ranges.some(([a, b]) => cp >= a && cp <= b));

// Latin-script letters: Latin Extended-A/B and Latin Extended Additional.
// Indic and other scripts fall back to the system by design (no Latin font
// carries them), and are not this test's business.
const isLatinExtended = (cp: number): boolean =>
  (cp >= 0x100 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff);

describe("bundled fonts cover the names we show (spec 08)", () => {
  it("each family has a latin and a latin-ext face, every file present", () => {
    for (const family of ["Inter", "Bricolage Grotesque"]) {
      const own = faces.filter((f) => f.family === family);
      expect(own.map((f) => /latin-ext/.test(f.src)).sort(), family).toEqual([false, true]);
      for (const f of own) expect(existsSync(resolve(__dirname, f.src)), f.src).toBe(true);
      for (const f of own)
        expect(f.ranges.length, `${f.src} has a unicode-range`).toBeGreaterThan(0);
    }
  });

  it("every Latin-script letter in a trek name is inside an Inter face's range", () => {
    const missing = new Set<string>();
    for (const t of treks) {
      for (const ch of t.name.normalize("NFC")) {
        const cp = ch.codePointAt(0)!;
        if (isLatinExtended(cp) && !covers("Inter", cp)) missing.add(ch);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("the display stack falls back to Inter before any system font", () => {
    // Bricolage's latin-ext subset lacks the dot-below letters of Indic
    // transliteration (ṭ ṇ ḍ ṣ ṛ); Inter has them, so a heading borrows the
    // glyph from the body face instead of a system font.
    const display = (tailwind.theme?.extend?.fontFamily as Record<string, string[]>).display;
    expect(display.slice(0, 2)).toEqual(['"Bricolage Grotesque"', '"Inter"']);
  });
});

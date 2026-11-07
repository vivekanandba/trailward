import { describe, it, expect } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { qualifyingTreks } from "./pages";
import { cardPages, cardSvg, canRender, renderCard, titleLayout } from "./socialCard";
import type { Trek } from "../../src/lib/trek";

// Spec 35 §E, spec 44 R17: a trek's link preview shows that trek, typographic
// only, every word from a field the record holds (D1).
const t = (over: Partial<Trek>): Trek => ({
  id: "x",
  name: "Skandagiri",
  lat: 13,
  lng: 77,
  tier: "discovery",
  sources: [],
  verified: false,
  ...over,
});

describe("cardSvg", () => {
  it("carries the name and only the facts the record holds", () => {
    const svg = cardSvg(t({ elevationM: 1350, difficulty: "Moderate", reliefM: 318 }))!;
    expect(svg).toContain(">Skandagiri<");
    expect(svg).toContain("1350 m · Moderate · 318 m relief");
    const bare = cardSvg(t({}))!;
    expect(bare).not.toMatch(/undefined|NaN| · · |>\s*·|·\s*</);
  });

  it("marks a terrain-estimated difficulty as an estimate", () => {
    expect(cardSvg(t({ estimatedDifficulty: "Hard" }))).toContain("est. Hard");
  });

  it("escapes the name: it is untrusted input in markup", () => {
    expect(cardSvg(t({ name: 'A <b> & "c"' }))).toContain("A &lt;b&gt; &amp; &quot;c&quot;");
  });

  it("cuts a name too long for two lines at a word, with an ellipsis", () => {
    const svg = cardSvg(
      t({ name: "Sri Malai Mahadeshwara Hills Wildlife Sanctuary Peak Number Three" }),
    )!;
    const lines = [...svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(lines[1].length).toBeLessThanOrEqual(27);
  });

  it("wraps a long name onto two lines instead of running off the card", () => {
    const svg = cardSvg(t({ name: "Bilikal Rangaswamy Betta Fort Hill Temple" }))!;
    expect(svg.match(/<tspan /g)!.length).toBe(2);
  });
});

describe("canRender", () => {
  it("accepts Latin and Latin Extended, which the card font covers", () => {
    expect(canRender("Kumāra Parvatha ṭ")).toBe(true);
  });

  it("refuses a script the card font lacks, so it falls back rather than draw boxes", () => {
    expect(canRender("नंदी हिल्स")).toBe(false);
    expect(canRender("Nandi ಬೆಟ್ಟ")).toBe(false);
  });
});

describe("cardPages", () => {
  it("is every curated page plus the top hidden gems, never one it cannot render", () => {
    const pages = [
      t({ id: "c1", tier: "curated" }),
      t({ id: "g1", discoveryScore: 0.9 }),
      t({ id: "g2", discoveryScore: 0.5 }),
      t({ id: "g3", discoveryScore: 0.95, name: "ಬೆಟ್ಟ" }),
      t({ id: "g4", discoveryScore: 0.7 }),
    ];
    expect(cardPages(pages, 2).map((p) => p.id)).toEqual(["c1", "g1", "g4"]);
  });
});

describe("renderCard", () => {
  it("renders a 1200×630 PNG", () => {
    const png = renderCard(cardSvg(t({ name: "Kumāra Parvatha", elevationM: 1712 }))!);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
  });
});

describe("canRender refuses what cannot be drawn", () => {
  it("keeps a name with a control or invisible format character on the global card", () => {
    for (const bad of [
      "Kote\u000bBetta",
      "Kote\u2028Betta",
      "Kote\u200bBetta",
      "Kote\u202eBetta",
    ]) {
      expect(canRender(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(canRender("Kumāra Parvatha")).toBe(true);
  });
});

describe("titleLayout — the title fits the card, measured by the renderer", () => {
  const font = resolve(__dirname, "../cards/DejaVuSans-Bold.ttf");
  const widest = (name: string): number => {
    const { lines, size } = titleLayout(name);
    return Math.max(
      ...lines.map((l) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><text x="80" y="300" font-family="DejaVu Sans" font-weight="bold" font-size="${size}">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
        const box = new Resvg(svg, {
          font: { fontFiles: [font], loadSystemFonts: false },
        }).getBBox()!;
        return box.x + box.width;
      }),
    );
  };

  for (const name of [
    "Channarayana Durga",
    "Skandagiri",
    "Bilikal Rangaswamy Betta",
    "Kumāra Parvatha",
    "Sri Malai Mahadeshwara Hills Wildlife Sanctuary Peak",
  ]) {
    it(`keeps "${name}" inside the 1120 px right margin`, () => {
      expect(widest(name)).toBeLessThanOrEqual(1120);
    });
  }

  it("shrinks before it cuts: a name that fits whole at a smaller size is never cut", () => {
    // At 96 px this lost its last word ("Rangaswamy…"); at 84 px it fits whole.
    const { lines, size } = titleLayout("Bilikal Rangaswamy Betta");
    expect(lines.join(" ")).toBe("Bilikal Rangaswamy Betta");
    expect(size).toBeLessThan(96);
    expect(titleLayout("Skandagiri")).toEqual({ lines: ["Skandagiri"], size: 96 });
  });

  it("cuts only what cannot fit in two lines even at 64 px, at a word", () => {
    const { lines, size } = titleLayout("Sri Malai Mahadeshwara Hills Wildlife Sanctuary Peak");
    expect(size).toBe(64);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
  });

  it("cuts no carded name that fits whole at some size", () => {
    const treks = JSON.parse(
      readFileSync(resolve(__dirname, "../../src/data/treks.json"), "utf8"),
    ) as Trek[];
    const cut = cardPages(qualifyingTreks(treks))
      .map((t) => ({ name: t.name, shown: titleLayout(t.name).lines.join(" ") }))
      .filter(({ name, shown }) => shown !== name);
    // Only names too long for two 64 px lines may be cut.
    for (const { name } of cut) expect(name.length, name).toBeGreaterThan(2 * 22);
  });

  it("keeps every name that actually gets a card inside the margin", () => {
    const treks = JSON.parse(
      readFileSync(resolve(__dirname, "../../src/data/treks.json"), "utf8"),
    ) as Trek[];
    const carded = cardPages(qualifyingTreks(treks));
    expect(carded.length).toBeGreaterThan(100);
    const over = carded.filter((t) => widest(t.name) > 1120).map((t) => t.name);
    expect(over).toEqual([]);
  });
});

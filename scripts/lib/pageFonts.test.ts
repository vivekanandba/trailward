import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LATIN_EXT_RANGE, LATIN_RANGE, pageFontFaces } from "./pageFonts";

// Spec 08 / spec 35: static pages show the same names as the app, in the same
// type. They used system-ui, which renders differently on every machine (the
// static screenshot differed 23% between the fleet VM and the CI runner).
const ASSETS = [
  "index-a1.js",
  "inter-latin-var-Dx4kXJAl.woff2",
  "inter-latin-ext-var-Q9zz.woff2",
  "bricolage-grotesque-latin-var-DLoe.woff2",
];

describe("pageFontFaces", () => {
  it("declares Inter's two faces at their hashed asset paths, with their ranges", () => {
    const css = pageFontFaces(ASSETS);
    expect(css).toContain('url("/trailward/assets/inter-latin-var-Dx4kXJAl.woff2")');
    expect(css).toContain('url("/trailward/assets/inter-latin-ext-var-Q9zz.woff2")');
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain(`unicode-range:${LATIN_RANGE}`);
    expect(css).toContain(`unicode-range:${LATIN_EXT_RANGE}`);
  });

  it("does not mistake the latin-ext file for the latin one", () => {
    const css = pageFontFaces(["inter-latin-ext-var-Q9zz.woff2", "inter-latin-var-X.woff2"]);
    expect(css.indexOf("inter-latin-var-X")).toBeLessThan(css.indexOf("inter-latin-ext-var-Q9zz"));
  });

  it("refuses when a face is missing, rather than shipping pages that fall back silently", () => {
    expect(() => pageFontFaces(["inter-latin-var-X.woff2"])).toThrow(/inter-latin-ext/);
    expect(() => pageFontFaces(["index.js"])).toThrow(/inter-latin-var/);
  });

  it("uses the same ranges as the app's own @font-face rules (CON-COV-003)", () => {
    const appCss = readFileSync(resolve(__dirname, "../../src/index.css"), "utf8").replace(
      /\s+/g,
      "",
    );
    expect(appCss).toContain(`unicode-range:${LATIN_RANGE.replace(/\s+/g, "")}`);
    expect(appCss).toContain(`unicode-range:${LATIN_EXT_RANGE.replace(/\s+/g, "")}`);
  });
});

/**
 * The bundled Inter faces for the static pages (spec 08, spec 35). Vite emits
 * the woff2 files with a content hash, so the generator finds them in
 * dist/assets after the app build and declares them, with the same
 * unicode-range the app uses: the latin-ext file loads only for a name that
 * needs it. A build without them refuses, rather than shipping pages that fall
 * back to whatever system font the reader has.
 */
export const LATIN_RANGE =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
export const LATIN_EXT_RANGE =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const face = (file: string, range: string): string =>
  `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;` +
  `src:url("/trailward/assets/${file}") format("woff2-variations");unicode-range:${range}}`;

export function pageFontFaces(assets: string[]): string {
  const find = (re: RegExp, name: string): string => {
    const hit = assets.find((a) => re.test(a));
    if (!hit) throw new Error(`[pages] no ${name} woff2 in dist/assets — run the app build first`);
    return hit;
  };
  const latin = find(/^inter-latin-var-[^.]+\.woff2$/, "inter-latin-var");
  const ext = find(/^inter-latin-ext-var-[^.]+\.woff2$/, "inter-latin-ext-var");
  return face(latin, LATIN_RANGE) + face(ext, LATIN_EXT_RANGE);
}

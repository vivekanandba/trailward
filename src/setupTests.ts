import "@testing-library/jest-dom/vitest";

// jsdom implements no layout, so Element.scrollIntoView is absent. The app
// calls it to reveal the selected row (spec 33); stub it so component tests
// exercise that path instead of throwing.
// The `typeof` guard lets a file opt into `@vitest-environment node` (there is
// one: coverageConfig.test.ts, which imports the vite config and so pulls in
// esbuild, which jsdom's TextEncoder breaks) without this setup throwing.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

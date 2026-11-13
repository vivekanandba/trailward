import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// The shared runner sits at load 20-35, where rendering the whole App takes
// seconds: findBy*/waitFor get the same load-sized budget as the tests
// (vite.config.ts testTimeout). These assert behaviour, not speed (CON-VER-008).
configure({ asyncUtilTimeout: 10_000 });

// jsdom implements no layout, so Element.scrollIntoView is absent. The app
// calls it to reveal the selected row (spec 33); stub it so component tests
// exercise that path instead of throwing.
// The `typeof` guard lets a file opt into `@vitest-environment node` (there is
// one: coverageConfig.test.ts, which imports the vite config and so pulls in
// esbuild, which jsdom's TextEncoder breaks) without this setup throwing.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom has no object URLs either. The GPX export revokes its URL on a 10 s
// timer; a test that left that timer running made it call a missing function
// after the test had ended, and vitest pinned the TypeError on whatever ran
// next. No-ops here keep any such late call harmless; tests spy on them.
if (typeof URL !== "undefined") {
  URL.createObjectURL ??= () => "blob:test";
  URL.revokeObjectURL ??= () => {};
}

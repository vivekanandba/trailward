import { defineConfig, devices } from "@playwright/test";

// E2E specs live in e2e/. They boot the Vite dev server and drive the real app.
// visual.spec.ts additionally diffs committed linux screenshot baselines
// (spec 33) — regenerate intentionally with `npm run e2e:update`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: {
      // 1% of pixels absorbs antialiasing wobble; a real layout/palette change
      // is orders of magnitude larger.
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
    },
  },
  snapshotPathTemplate: "e2e/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",
  use: {
    baseURL: "http://localhost:5173/trailward/",
    trace: "on-first-retry",
    // Collapses the spec-33 transitions (sheet/panel/scrim) AND Leaflet's own
    // pan/zoom animation for every test — visual and smoke alike.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173/trailward/",
    reuseExistingServer: !process.env.CI,
  },
});

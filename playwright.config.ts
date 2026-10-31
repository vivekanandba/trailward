import { defineConfig, devices } from "@playwright/test";
import { serversFor } from "./scripts/lib/playwrightServers";

const servers = serversFor(process.argv);

// E2E specs live in e2e/. They boot the Vite dev server and drive the real app.
// visual.spec.ts additionally diffs committed linux screenshot baselines
// (spec 33). They come only from the "Update visual baselines" workflow, which
// renders on the pinned CI image (spec 42 §E); a failing local run leaves its
// actual and diff images in test-results/ to see what changed.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A bound on a HANG, not a speed assertion (spec 42 §E). The local gate shares
  // the fleet VM with every other project's CI; a first test that pays for the dev
  // server's cold compile at a load average of 13 needed more than the 30 s
  // default, while hanging tests still fail.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // A retry is kept so a failure leaves a trace (trace: "on-first-retry"), but
  // a test that only passes on retry FAILS the run: a flake is a suite defect
  // (CON-VER-008), and two silent retries were hiding them (spec 42 §E).
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  // Never write a baseline unless asked: a new screenshot run locally would
  // otherwise get its first baseline from this machine's fonts. The baseline
  // workflow asks with --update-snapshots=all (spec 42 §E).
  updateSnapshots: "none",
  expect: {
    // A bound on a HANG, like `timeout` above, not a speed assertion: every
    // assertion still polls for a state. 5 s let a cold mount at a load average
    // of 14 fail "granted permission refreshes the origin" with the app not yet
    // rendered (2026-10-31).
    timeout: 15_000,
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
    {
      name: "chromium",
      testIgnore: /(static|pwa)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    { name: "mobile", testIgnore: /(static|pwa)\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    {
      // The generated static surface (spec 35) does not exist on the dev
      // server: it is produced by `npm run build`. Run it against `vite
      // preview`, which serves the real dist/ under the real /trailward/ base
      // path — so base-path and asset-resolution bugs surface in CI rather
      // than in production.
      name: "static",
      // NB: this project is run in its OWN pass, not alongside the app ones —
      // see `npm run e2e` (CON-VER-008). `vite preview` serves a full
      // production build (3,886 generated pages) and on a small machine it
      // starved the dev server: a bare `playwright test` failed on a DIFFERENT
      // test every run, always because trek data had not loaded, while each
      // passed in isolation. Playwright `dependencies` was tried and rejected:
      // it also SKIPS this project when an app test fails, which hides 19
      // results to fix a resource problem.
      // pwa.spec.ts joins it: a service worker cannot be exercised honestly
      // against the dev server (spec 43).
      testMatch: /(static|pwa)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4173/trailward/" },
    },
  ],
  // Only the servers the requested projects use: Playwright starts every one
  // listed, and an app-only pass paid for a full production build (spec 42 §E).
  webServer: [
    ...(servers.includes("dev")
      ? [
          {
            command: "npm run dev",
            url: "http://localhost:5173/trailward/",
            reuseExistingServer: !process.env.CI,
          },
        ]
      : []),
    ...(servers.includes("preview")
      ? [
          {
            command: "npm run build && npx vite preview --port 4173",
            url: "http://localhost:4173/trailward/",
            reuseExistingServer: !process.env.CI,
            timeout: 180_000, // a full build: sitemap + vite + 3,886 trek pages
          },
        ]
      : []),
  ],
});

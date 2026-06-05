import { defineConfig, devices } from "@playwright/test";

// E2E specs live in e2e/. They boot the Vite dev server and drive the real app.
// Real flows (origin switch, radius/filters, feedback) are authored in Phase B.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173/trailward/",
    trace: "on-first-retry",
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

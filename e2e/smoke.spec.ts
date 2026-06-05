import { test, expect } from "@playwright/test";

// Sample E2E — confirms the Playwright harness boots the app.
// Replaced by real user-flow specs in Phase B.
test("app loads and shows the Trailward heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trailward" })).toBeVisible();
});

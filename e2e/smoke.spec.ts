import { test, expect } from "@playwright/test";

test("default Bangalore view renders map, markers and curated treks", async ({ page }) => {
  await page.goto("/");

  // App shell
  await expect(page.getByRole("heading", { name: "Trailward" })).toBeVisible();

  // Curated data in the list
  await expect(page.getByText("Skandagiri")).toBeVisible();

  // Leaflet map: tiles + interactive markers (origin, ring, trek pins)
  await expect(page.locator("img.leaflet-tile").first()).toBeVisible();
  expect(await page.locator("path.leaflet-interactive").count()).toBeGreaterThan(5);
});

test("selecting a trek opens its detail with a directions link", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Skandagiri").first().click();
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Directions" })).toBeVisible();
});

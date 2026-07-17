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

test("difficulty filter narrows the list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Skandagiri")).toBeVisible(); // Moderate trek, present by default
  await page.getByRole("button", { name: "Hard", exact: true }).click();
  // Filtering to Hard drops the Moderate Skandagiri and keeps a Hard trek.
  await expect(page.getByText("Skandagiri")).toHaveCount(0);
  await expect(page.getByText("Savandurga")).toBeVisible();
});

test("a shared URL restores filters and the open trek", async ({ page }) => {
  await page.goto("/?oid=bangalore&olat=12.97160&olng=77.59460&on=Bengaluru&d=Hard&sel=savandurga");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Savandurga" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hard", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

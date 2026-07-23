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

test("a preset region shows topography-ranked discovery peaks", async ({ page }) => {
  await page.goto("/");
  // Jump to a precomputed preset region (baked discovery, no live call needed).
  await page.getByRole("button", { name: "Pune" }).click();

  // The topography banner and estimated-difficulty labels appear.
  await expect(page.getByText(/ranked by terrain/i)).toBeVisible();
  await expect(page.getByText(/est\./i).first()).toBeVisible();

  // Opening a discovery peak shows the computed Terrain section.
  await page.getByText(/est\./i).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Terrain", { exact: true })).toBeVisible();
  await expect(page.getByText(/hidden-gem score/i)).toBeVisible();
  await expect(page.getByText(/community · unverified/i)).toBeVisible();
});

test("hidden-gems filter narrows a preset region's list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pune" }).click();
  await expect(page.getByText(/ranked by terrain/i)).toBeVisible();
  const before = await page.locator("aside li").count();
  await page.getByLabel("Hidden gems only").check();
  await expect.poll(async () => page.locator("aside li").count()).toBeLessThan(before);
});

test("the map shows a difficulty legend", async ({ page }) => {
  await page.goto("/");
  const legend = page.locator("text=unverified").last();
  await expect(legend).toBeVisible();
  await expect(page.getByText("Moderate", { exact: true }).last()).toBeVisible();
});

test("basemap defaults to terrain and toggles to the street map", async ({ page }) => {
  await page.goto("/");
  // Terrain (OpenTopoMap) is the default for this trekking app.
  await expect(page.locator('img.leaflet-tile[src*="opentopomap.org"]').first()).toBeVisible();
  await page.getByRole("button", { name: "map", exact: true }).click();
  await expect(page.locator('img.leaflet-tile[src*="cartocdn.com"]').first()).toBeVisible();
});

test("clicking another peak switches the open detail (desktop side panel)", async ({ page }) => {
  // Desktop-only: on mobile the detail is a full-screen modal that covers the list.
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "desktop side-panel behaviour");
  await page.goto("/");
  await page.getByText("Skandagiri").first().click();
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toBeVisible();
  // With the detail open, click a different peak in the list — it should switch.
  await page.getByText("Nandi Hills").first().click();
  await expect(page.getByRole("heading", { name: "Nandi Hills" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toHaveCount(0);
});

test("'use my location' sets the origin from geolocation", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 15.85, longitude: 74.5 }); // near the W. Ghats
  await page.goto("/");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByLabel("Search for an origin place")).toHaveAttribute(
    "placeholder",
    /My location/,
  );
});

test("a trek can be downloaded as GPX", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Skandagiri").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "GPX", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("skandagiri.gpx");
});

// Regression: on narrow viewports the map used to collapse to 0px because the
// list rail consumed the whole column, leaving nothing for the flex-basis-0 map
// (App.tsx body layout). The map must occupy a real slice of the viewport.
test("map is actually visible on a mobile viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("img.leaflet-tile").first()).toBeVisible();
  const map = page.locator(".leaflet-container");
  const box = await map.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "map container should have a layout box").not.toBeNull();
  // At least a third of the viewport height, so it's genuinely usable — not a sliver.
  expect(box!.height).toBeGreaterThan((viewport?.height ?? 0) / 3);
  expect(box!.width).toBeGreaterThan(0);
});

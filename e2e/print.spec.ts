import { test, expect } from "@playwright/test";
import { stubTiles } from "./helpers/deterministic";

// Spec 44 R5: a selected trek prints as its card. Playwright's print emulation
// never fires `beforeprint`, so this checks layout, not the printed date
// (which a unit test drives).
test.beforeEach(async ({ page }) => {
  await stubTiles(page);
});

test("a selected trek prints as a card: no map, no header, no buttons", async ({ page }) => {
  await page.goto("/?sel=skandagiri");
  await expect(page.getByRole("heading", { name: "Skandagiri", level: 2 })).toBeVisible();
  await page.emulateMedia({ media: "print" });

  await expect(page.locator(".leaflet-container")).toBeHidden();
  await expect(page.locator("header")).toBeHidden();
  await expect(page.getByRole("link", { name: "Directions" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Skandagiri", level: 2 })).toBeVisible();

  const card = page.getByTestId("print-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d+°\d{2}′\d{2}″N \d+°\d{2}′\d{2}″E/);
  await expect(card).toContainText("https://www.google.com/maps/dir/?api=1&destination=");

  // The card is laid out at full width, not as an overlay off to one side.
  const box = await page.locator('[data-print="card"]').boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.width).toBeGreaterThan(width * 0.9);
});

test("on screen the print block stays hidden", async ({ page }) => {
  await page.goto("/?sel=skandagiri");
  await expect(page.getByRole("heading", { name: "Skandagiri", level: 2 })).toBeVisible();
  await expect(page.getByTestId("print-card")).toBeHidden();
});

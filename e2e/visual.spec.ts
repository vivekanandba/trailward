/**
 * Visual regression suite (spec 33) — committed linux baselines of the
 * canonical UI states, diffed in CI (the same e2e gate). Tiles and
 * third-party APIs are stubbed deterministic (helpers/deterministic.ts);
 * `reducedMotion: "reduce"` in the shared config collapses transitions.
 *
 * Regenerate intentionally with: npm run e2e:update
 */
import { test, expect, type Page } from "@playwright/test";
import { deterministicPage } from "./helpers/deterministic";

// Baselines are rendered on linux (local + CI agree); other platforms would
// generate a second, conflicting set.
test.skip(process.platform !== "linux", "visual baselines are linux-only");

const BLR = "oid=bangalore&olat=12.97160&olng=77.59460&on=Bengaluru";

async function settled(page: Page, url: string): Promise<void> {
  await deterministicPage(page);
  await page.goto(url);
  // The sr-only loading status disappearing = cells loaded and rows rendered.
  await page.locator("role=status >> text=/Loading peaks/").waitFor({ state: "detached" });
  await page.waitForTimeout(600); // map pan/zoom settle (animations disabled)
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

test("visual: list view, light", async ({ page }) => {
  await settled(page, `/?${BLR}`);
  await expect(page).toHaveScreenshot("list-light.png");
});

test("visual: list view, dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await settled(page, `/?${BLR}`);
  await expect(page).toHaveScreenshot("list-dark.png");
});

test("visual: detail open, light", async ({ page }) => {
  await settled(page, `/?${BLR}&sel=skandagiri`);
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toBeVisible();
  await expect(page).toHaveScreenshot("detail-light.png");
});

test("visual: detail open, dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await settled(page, `/?${BLR}&sel=skandagiri`);
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toBeVisible();
  await expect(page).toHaveScreenshot("detail-dark.png");
});

test("visual: empty state (impossible filter combo)", async ({ page }) => {
  await settled(page, `/?${BLR}&q=zzzznomatch`);
  await expect(page.getByText(/No treks match/)).toBeVisible();
  await expect(page).toHaveScreenshot("empty.png");
});

test("visual: filters surface", async ({ page }) => {
  await settled(page, `/?${BLR}`);
  if (isMobile(page)) {
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.waitForTimeout(400); // sheet transition (reduced but settle anyway)
  }
  await expect(page.getByLabel("Search treks")).toBeVisible();
  await expect(page).toHaveScreenshot("filters.png");
});

test("visual: command palette open", async ({ page }) => {
  // The palette is the only way across the country (spec 38) and nothing
  // captured it: a change to its layout or contrast shipped unseen.
  await settled(page, `/?${BLR}`);
  if (isMobile(page)) {
    await page.getByRole("button", { name: /search any summit/i }).click();
  } else {
    await page.keyboard.press("ControlOrMeta+k");
  }
  const palette = page.getByRole("dialog");
  await expect(palette.getByRole("combobox")).toBeVisible();
  await palette.getByRole("combobox").fill("Kumara");
  await expect(palette.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("palette.png");
});

test("visual: results sheet at its half snap", async ({ page }) => {
  // Mobile only: the half snap is where the sheet and the map share the
  // screen, and it is the state a sizing bug shows up in (the GPX button once
  // sat below the viewport there).
  test.skip(!isMobile(page), "the sheet exists only on the mobile layout");
  await settled(page, `/?${BLR}`);
  await page.getByRole("button", { name: /^Filters/ }).waitFor();
  // Drag the sheet handle up to the middle snap.
  const handle = page
    .getByRole("button", { name: /resize panel/i })
    .or(page.locator('[aria-label="Resize panel"]'));
  await handle.first().press("ArrowUp");
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("sheet-half.png");
});

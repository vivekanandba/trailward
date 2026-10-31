import { test, expect, type Page } from "@playwright/test";
import { resultsLoaded, stubTiles } from "./helpers/deterministic";

// Spec 44 rows 1, 5 and 6, in a real browser. These need motion allowed, which
// the suite otherwise forces off (playwright.config.ts), so this file opts out.
test.use({ contextOptions: { reducedMotion: "no-preference" } });

test.beforeEach(async ({ page }) => {
  await stubTiles(page);
});

const isDesktop = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) >= 1024;

test("keyboard focus is always visible (spec 44 D4)", async ({ page }) => {
  await page.goto("/");
  await resultsLoaded(page);
  // The first several Tab stops: each must draw an outline or a ring.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const drawn = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return "body";
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
      const ring = cs.boxShadow !== "none";
      return outline || ring ? "ok" : `${el.tagName}.${el.className}`.slice(0, 80);
    });
    expect(drawn, `Tab stop ${i + 1}`).toMatch(/^(ok|body)$/);
  }
});

test("a deep-linked selection opens in place: no slide, no ring (spec 44 row 6)", async ({
  page,
}) => {
  test.skip(!isDesktop(page), "the desktop panel; the sheet is covered below");
  await page.goto("/?sel=skandagiri");
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toBeVisible();
  expect(await page.locator(".panel-enter").count()).toBe(0);
  // The panel takes focus on mount, but nobody used a keyboard: no ring is
  // drawn. (Chrome still reports :focus-visible for a script's focus before any
  // interaction, which is why the app marks it quiet; what matters is the ring.)
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle };
  });
  expect(ring.outline, `${ring.tag} on load`).toBe("none");
});

test("a selection made by a press slides in (spec 44 row 6)", async ({ page }) => {
  test.skip(!isDesktop(page), "the desktop panel");
  await page.goto("/");
  await resultsLoaded(page);
  await page.locator("#results button").first().click();
  await expect(page.locator(".panel-enter")).toHaveCount(1);
});

test("the mobile sheet does not slide on a deep link (spec 44 row 6)", async ({ page }) => {
  test.skip(isDesktop(page), "the mobile sheet");
  await page.goto("/?sel=skandagiri");
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toBeVisible();
  const transitions = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[role=dialog], [aria-modal]")].map(
      (el) => el.style.transition,
    ),
  );
  for (const t of transitions) expect(t === "" || t === "none", t).toBe(true);
});

test("the theme icon turns only after a press, never on load (spec 44 row 5)", async ({ page }) => {
  await page.goto("/");
  await resultsLoaded(page);
  const icon = page.getByTestId("theme-icon");
  await expect(icon).not.toHaveClass(/theme-icon-in/);
  await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).click();
  await expect(page.getByTestId("theme-icon")).toHaveClass(/theme-icon-in/);
});

test("been there: a tick survives a reload and the filter finds it (spec 44 R16)", async ({
  page,
}) => {
  await page.goto("/?sel=skandagiri");
  const toggle = page.getByRole("button", { name: "Been there" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/^Ticked on .*, on this device\.$/)).toBeVisible();

  await page.goto("/?mine=1");
  await resultsLoaded(page);
  await expect(page.locator("#results").getByText("Skandagiri")).toBeVisible();
  await expect(page.locator("#results li button")).toHaveCount(1);
});

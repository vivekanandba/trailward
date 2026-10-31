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

test("nothing loops or runs long while a deep link loads, before any press (spec 44 R4)", async ({
  page,
}) => {
  // What the browser is actually animating, whatever wrote it: a Tailwind
  // class, a shorthand list, an inline style. The source scans miss some forms.
  // The cell files are held back, so the check runs while the list is still
  // loading: the loading skeletons once pulsed for 2 s, forever, right there.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/data\/cells\/\d/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/?sel=skandagiri");
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible(); // still loading
  await page.waitForTimeout(400); // past any short entrance, so what remains is long or looping
  const running = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => {
          const t = a.effect!.getComputedTiming();
          const el = (a.effect as KeyframeEffect).target as Element | null;
          return {
            what: `${el?.tagName ?? "?"}.${String(el?.className ?? "").slice(0, 60)}`,
            looping: t.iterations === Infinity,
            ms: Number(t.duration),
          };
        })
        .filter((x) => x.looping || x.ms > 300),
    );
  expect(await running(), "while loading").toEqual([]);
  release();
  await resultsLoaded(page);
  expect(await running(), "once loaded").toEqual([]);
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

test("a new origin flies there and settles on its peaks (spec 44 R9)", async ({ page }) => {
  await page.goto("/");
  await resultsLoaded(page);
  // The city chips: in the side panel on a desktop, in the results sheet on
  // a phone (opening Filters there covered them with its dialog).
  await page.getByRole("button", { name: "Pune" }).click();
  await resultsLoaded(page);
  // Where the motion ends, not the motion: the area card speaks of Pune.
  await expect(page.getByTestId("region-sentence")).toContainText("around Pune");
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

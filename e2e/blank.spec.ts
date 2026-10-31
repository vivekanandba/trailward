import { test, expect } from "@playwright/test";
import { resultsLoaded, stubTiles } from "./helpers/deterministic";
import { GREETING } from "../src/lib/greeting";

// Spec 44 R11, R14, R15 in a browser.
test.beforeEach(async ({ page }) => {
  await stubTiles(page);
});

test("an empty list offers to widen the radius, and does it (spec 44 R11)", async ({ page }) => {
  // Open sea off the west coast, 10 km: nothing there.
  await page.goto("/?oid=geo%3A15%2C70&olat=15.00000&olng=70.00000&on=Arabian%20Sea&r=10");
  await resultsLoaded(page);
  await page.getByRole("button", { name: "Widen to 20 km" }).click();
  await resultsLoaded(page);
  await expect(page).toHaveURL(/[?&]r=20\b/);
});

test("going offline says so, and coming back clears it (spec 44 R14)", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await resultsLoaded(page);
  await context.setOffline(true);
  await expect(page.getByText(/^You're offline\./)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/^You're offline\./)).toBeHidden();
});

test("the console greets once, and the app logs nothing else on load (spec 44 R15)", async ({
  page,
}) => {
  const messages: { type: string; text: string }[] = [];
  page.on("console", (m) => messages.push({ type: m.type(), text: m.text() }));
  await page.goto("/");
  await resultsLoaded(page);
  // The dev server's own lines (Vite, React DevTools) and failed network
  // fetches are the browser's, not the app's.
  const app = messages.filter(
    (m) =>
      !/^\[vite\]|React DevTools|Failed to load resource|Download the React DevTools/.test(m.text),
  );
  expect(app).toEqual([{ type: "info", text: GREETING }]);
});

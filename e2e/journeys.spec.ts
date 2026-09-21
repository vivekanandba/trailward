/**
 * Journeys (spec 42 §D) — what someone was trying to DO, asserted end to end.
 *
 * The existing specs check features: a filter narrows a list, a URL restores
 * state. Those are necessary and they all pass while a person is still unable
 * to get from "I'm in Bengaluru and want a hill this weekend" to a route on
 * their phone. Each test here is one of those arcs, and it fails if any step
 * in the middle breaks — which is the point.
 */
import { test, expect, type Page } from "@playwright/test";

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 1024;

test("find a trek near a place, then get directions to it", async ({ page }) => {
  await page.goto("/");

  // 1. Start somewhere. The origin is the thing every distance is measured
  //    from, so the journey begins by choosing it.
  await page.getByRole("button", { name: "Pune" }).click();
  await expect(page.getByText(/ranked by terrain/i)).toBeVisible();

  // 2. Narrow to something achievable.
  if (isMobile(page)) await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("button", { name: "Easy", exact: true }).click();
  if (isMobile(page)) await page.keyboard.press("Escape");

  // 3. Open the first result and get a route out of it.
  const firstResult = page.getByRole("button", { name: /est\./i }).first();
  await firstResult.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toBeVisible();

  const directions = detail.getByRole("link", { name: "Directions" });
  await expect(directions).toBeVisible();
  const href = await directions.getAttribute("href");
  const params = new URL(href!).searchParams;

  // The destination is the trek's own coordinates.
  expect(params.get("destination")).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/);
  expect(href).not.toContain("undefined");
  expect(href).not.toContain("NaN");
  // And the ORIGIN is deliberately absent (spec 06/34): Maps routes from
  // where the phone actually is. Pinning the search origin here is the bug
  // that routed someone browsing Himachal from 2,400 km away in Bengaluru.
  expect(params.get("origin")).toBeNull();
});

test("arrive from a search engine on a trek page, and open it on the map", async ({ page }) => {
  // Someone lands on a generated page from Google. The page has to be able to
  // hand them to the live map with that trek already selected, or the static
  // surface is a dead end.
  await page.goto("/?sel=skandagiri&oid=bangalore&olat=12.97160&olng=77.59460&on=Bengaluru");
  await expect(page.getByRole("heading", { name: "Skandagiri" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Directions" })).toBeVisible();
});

test("jump to a summit in another state without touching the map", async ({ page }) => {
  await page.goto("/");

  // The palette is how someone crosses the country. On mobile it opens from
  // the search affordance rather than a keyboard shortcut.
  if (isMobile(page)) {
    await page
      .getByRole("button", { name: /search/i })
      .first()
      .click();
  } else {
    await page.keyboard.press("ControlOrMeta+k");
  }
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();

  await palette.getByRole("combobox").fill("Kumara");
  // A result for a summit far outside the current radius must be reachable —
  // the whole point of the palette is that it is not radius-bound.
  const hit = palette.getByRole("option").first();
  await expect(hit).toBeVisible({ timeout: 10_000 });
  const chosen = (await hit.innerText()).split("\n")[0].trim();
  await hit.click();

  // The goal was to LAND on that summit, not merely to close a dialog. Assert
  // the summit is open by name. Note what does NOT work here: the detail is
  // itself a dialog, so "a dialog is visible" asserts nothing, and the header
  // keeps its own place-search combobox, so counting comboboxes asserts
  // nothing either.
  await expect(page.getByRole("listbox")).toHaveCount(0); // the palette's results are gone
  await expect(page.getByRole("heading", { name: chosen })).toBeVisible();
});

test("reach the results with the keyboard alone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Skandagiri")).toBeVisible();

  // The skip link is invisible until focused, so it is exactly the thing that
  // rots unnoticed. What matters to a keyboard user is that it is REACHABLE
  // early — not that it holds one particular ordinal, which differs between
  // the desktop rail and the mobile sheet (measured: first stop on desktop,
  // later on mobile, where a scroll container precedes it).
  const skip = page.getByRole("link", { name: /skip to (results|content)/i });
  let reached = false;
  for (let i = 0; i < 5 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await skip.evaluate((el) => el === document.activeElement).catch(() => false);
  }
  expect(reached, "the skip link was not reachable in the first 5 tab stops").toBe(true);
  await skip.press("Enter");

  // Focus must land in the results region, not back at the top of the page.
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  const landedInResults = await focused.evaluate((el) => {
    const region = document.querySelector("#results, [data-results], main");
    return Boolean(region && (region === el || region.contains(el)));
  });
  expect(landedInResults).toBe(true);
});

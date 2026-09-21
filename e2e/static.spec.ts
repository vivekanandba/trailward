/**
 * The generated static surface (spec 35): trek pages, robots, sitemap.
 *
 * These files do not exist on the dev server — they are produced by
 * `npm run build`. This project therefore runs against `vite preview`, which
 * serves the real dist/ under the real /trailward/ base path, so base-path and
 * asset-resolution bugs surface here rather than in production.
 */
import { test, expect } from "@playwright/test";

test("a trek page serves its facts in the HTML, without JavaScript", async ({ page }) => {
  // JS off: a crawler that doesn't execute scripts, and a reader on a dead
  // signal, must both get the full page.
  const res = await page.goto("t/skandagiri/");
  expect(res?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1, name: "Skandagiri" })).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).toContain("1350 m");
  expect(body).toContain("Moderate");
  expect(body).toContain("Chikkaballapur");
});

test("the trek page's canonical is absolute and never doubles the base path", async ({ page }) => {
  await page.goto("t/skandagiri/");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBe("https://vivekanandba.github.io/trailward/t/skandagiri/");
  expect(canonical).not.toContain("/trailward/trailward/");
  const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
  expect(ogUrl).toBe(canonical);
});

test("the trek page carries TouristAttraction structured data", async ({ page }) => {
  await page.goto("t/skandagiri/");
  const raw = await page.locator('script[type="application/ld+json"]').innerText();
  const ld = JSON.parse(raw) as { "@type": string; geo: { latitude: number } };
  expect(ld["@type"]).toBe("TouristAttraction");
  expect(ld.geo.latitude).toBeCloseTo(13.5021, 3);
});

test("the map link deep-links into the live app and opens that trek", async ({ page }) => {
  await page.goto("t/skandagiri/");
  await page.getByRole("link", { name: /Open on the map/ }).click();
  // Lands on the app with the trek selected — the spec 30/33 deep-link
  // contract. The app then mirrors origin+filters into the URL, so `sel` may
  // be the first param or a later one; matching only `?sel=` raced that
  // rewrite and was flaky.
  await expect(page).toHaveURL(/[?&]sel=skandagiri\b/);
  await expect(page.getByRole("heading", { name: "Skandagiri" }).first()).toBeVisible();
});

test("robots.txt and the sitemap are served and agree with each other", async ({ page }) => {
  const robots = await page.goto("robots.txt");
  expect(robots?.status()).toBe(200);
  const robotsText = (await robots!.text()).trim();
  expect(robotsText).toContain("Sitemap: https://vivekanandba.github.io/trailward/sitemap.xml");
  // The data plane stays crawlable — blocking it would render an empty map.
  expect(robotsText).not.toMatch(/^Disallow: \/trailward\/data\//m);

  const sitemap = await page.goto("sitemap.xml");
  expect(sitemap?.status()).toBe(200);
  const xml = await sitemap!.text();
  expect(xml).toContain("<loc>https://vivekanandba.github.io/trailward/t/skandagiri/</loc>");
});

test("every sitemap trek URL resolves to a real page (no dead advertisements)", async ({
  page,
  request,
}) => {
  await page.goto("sitemap.xml");
  const xml = await page.locator("body").innerText();
  const locs = [...xml.matchAll(/https:\/\/vivekanandba\.github\.io\/trailward\/(t\/[^<\s]+)/g)]
    .map((m) => m[1])
    .slice(0, 25); // a sample: 3,886 round-trips would dominate the suite
  expect(locs.length).toBeGreaterThan(5);
  for (const path of locs) {
    const res = await request.get(path);
    expect(res.status(), `${path} should exist`).toBe(200);
  }
});

test("the content pages are served, single-h1, and canonically correct (spec 36)", async ({
  page,
}) => {
  for (const [slug, heading] of [
    ["about", /About Trailward/],
    ["sources", /Data sources and licences/],
    ["data", /The dataset/],
  ] as const) {
    const res = await page.goto(`${slug}/`);
    expect(res?.status(), slug).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(await page.locator("h1").count(), slug).toBe(1);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe(`https://vivekanandba.github.io/trailward/${slug}/`);
  }
});

test("the sources page discharges the attribution obligation (spec 36)", async ({ page }) => {
  await page.goto("sources/");
  const body = await page.locator("body").innerText();
  // Every licence that REQUIRES attribution must name its source here.
  for (const required of ["GeoNames", "OpenStreetMap", "ESA WorldCover", "Open-Meteo"]) {
    expect(body, required).toContain(required);
  }
  for (const licence of ["CC-BY 4.0", "ODbL"]) {
    expect(body, licence).toContain(licence);
  }
  // And the licences must be linked, not merely named.
  await expect(page.getByRole("link", { name: /ODbL/ }).first()).toBeVisible();
});

test("the data page reports live counts, not prose (spec 36)", async ({ page }) => {
  await page.goto("data/");
  const body = await page.locator("body").innerText();
  expect(body).toMatch(/Total summits\s+[\d,]{6,}/);
  expect(body).toMatch(/Still unnamed\s+[\d,]{5,}/);
});

test("the app links to attribution — a licence obligation, not only an SEO page", async ({
  page,
}) => {
  await page.goto("./");
  const sources = page.getByRole("link", { name: /Sources & licences/ }).first();
  await expect(sources).toBeVisible();
  await sources.click();
  await expect(page).toHaveURL(/\/sources\//);
});

test("visual: a generated trek page", async ({ page }) => {
  // 3,886 of these ship and none was ever captured. One is the contract —
  // capturing all of them would be noise (spec 42 §C).
  await page.goto("t/skandagiri/");
  await expect(page.getByRole("heading", { level: 1, name: "Skandagiri" })).toBeVisible();
  await expect(page).toHaveScreenshot("trek-page.png");
});

test("visual: the sources content page", async ({ page }) => {
  await page.goto("sources/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveScreenshot("sources-page.png");
});

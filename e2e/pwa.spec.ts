/**
 * The PWA (spec 43) — manifest, service worker, offline.
 *
 * Runs in the `static` project against a REAL production build served by
 * `vite preview` at the real base path. A service worker cannot be exercised
 * against the dev server: registration is deliberately production-only
 * (src/main.tsx), and the caching this asserts is about hashed assets and
 * generated files that only a build produces.
 *
 * Nothing here reads sw.js's source. Offline is proven by going offline.
 */
import { test, expect, type Page } from "@playwright/test";

/** Resolve once the worker controlling this page is active. */
async function workerReady(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg?.active);
    },
    undefined,
    { timeout: 20_000 },
  );
  // `controller` is what decides whether the NEXT navigation is intercepted.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, {
    timeout: 20_000,
  });
}

test.describe("manifest", () => {
  test("parses, and every icon it names actually exists", async ({ page, request }) => {
    await page.goto("");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();

    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    const manifest = JSON.parse(await res.text()) as {
      id?: string;
      name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };

    // An install dialog is built from these. A promised icon that 404s is a
    // broken image in the one screen that asks someone to trust the app —
    // and nothing checked it before.
    //
    // Status alone proves nothing here: the SPA fallback answers ANY unknown
    // path with 200 text/html, so a misspelt icon reads as present. Measured:
    // /icons/nope.png → 200 text/html. The content type is the real assertion.
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.status(), `${icon.src} (${icon.sizes})`).toBe(200);
      expect(iconRes.headers()["content-type"] ?? "", `${icon.src} is not an image`).toMatch(
        /^image\//,
      );
    }

    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/trailward/");
    expect(manifest.scope).toBe("/trailward/");
    // Without an `id`, identity derives from start_url — changing that later
    // installs a SECOND app rather than updating this one (spec 43 §C).
    expect(manifest.id).toBeTruthy();
    // Android needs a maskable icon or it renders the icon in a white blob.
    expect(manifest.icons.some((i) => i.purpose?.includes("maskable"))).toBe(true);
    // 192 and 512 are the two sizes the install path actually requires.
    const sizes = manifest.icons.flatMap((i) => i.sizes.split(" "));
    for (const needed of ["192x192", "512x512"]) expect(sizes).toContain(needed);
  });

  test("declares the iOS standalone meta, which the manifest alone does not cover", async ({
    page,
  }) => {
    await page.goto("");
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
});

test.describe("service worker", () => {
  test("registers and becomes the controller", async ({ page }) => {
    await page.goto("");
    await workerReady(page);
    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.scope ?? "";
    });
    expect(scope).toContain("/trailward/");
  });

  test("the app still renders after going OFFLINE and reloading", async ({ page, context }) => {
    // The whole promise of an offline shell, asserted for the first time.
    await page.goto("");
    await expect(page.getByRole("heading", { name: "Trailward" })).toBeVisible();
    await workerReady(page);

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Trailward" })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("a data cell viewed online is still served offline", async ({ page, context }) => {
    // Second visit on purpose. On a FIRST visit the page fetches its cells
    // before the worker controls it, so nothing it loaded passes through the
    // worker — the install handler precaches the cell index for exactly that
    // reason, but the honest scenario for cached cells is a return visit.
    await page.goto("");
    await workerReady(page);
    await page.reload();
    await expect(page.getByText("Skandagiri")).toBeVisible(); // cells, via the worker

    await context.setOffline(true);
    try {
      // Ask for a cell the page already pulled; the worker must answer it from
      // cache rather than letting the request fail. Status alone is not
      // enough — a cached HTML soft-404 is also a 200. Assert the shape.
      const body = await page.evaluate(async () => {
        const res = await fetch("/trailward/data/cells/index.json");
        return { status: res.status, text: (await res.text()).slice(0, 400) };
      });
      expect(body.status).toBe(200);
      const parsed = JSON.parse(
        body.text.startsWith("{") ? `${body.text.split('"cells"')[0]}}` : "{}",
      );
      expect(body.text, "must be the cell index, not an HTML soft-404").toContain('"cells"');
      expect(parsed).toBeTruthy();
    } finally {
      await context.setOffline(false);
    }
  });

  test("version.json is NOT pinned in the cache — it says which build is live", async ({
    page,
  }) => {
    // It is same-origin, not under data/, and not a navigation, so it used to
    // fall into the cache-first branch and be frozen forever (spec 43 §A).
    await page.goto("");
    await workerReady(page);

    const status = await page.evaluate(async () => {
      const res = await fetch("/trailward/version.json", { cache: "no-store" });
      return res.status;
    });
    expect(status).toBe(200);

    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      for (const k of keys) {
        const c = await caches.open(k);
        if (await c.match("/trailward/version.json", { ignoreVary: true })) return true;
      }
      return false;
    });
    expect(cached, "version.json must not be stored in any cache").toBe(false);
  });
});

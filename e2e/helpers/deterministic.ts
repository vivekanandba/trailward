/**
 * Deterministic rendering for the visual suite (spec 33). Screenshots must
 * not depend on live third parties: basemap tiles are served from committed
 * flat PNGs (masking the tile pane instead would blind the suite to exactly
 * the layers the UI overhaul changed — pins, clusters, halo, legend), weather
 * is a fixed payload, and the lazy-enrichment endpoints return nothing.
 * The smoke suite stubs tiles too (CON-VER-008). It used to stay unstubbed on
 * the grounds that it "asserts real tile URLs" — but `route.fulfill` replaces
 * the response and leaves the request URL alone, so `img.src` still carries
 * the real host those assertions read. What the live fetch actually bought was
 * a dependency on a third-party CDN under parallel load, which made the suite
 * fail on a different test each run.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const lightTile = readFileSync(resolve(here, "../fixtures/tile-light.png"));
const darkTile = readFileSync(resolve(here, "../fixtures/tile-dark.png"));

export async function stubTiles(page: Page): Promise<void> {
  await page.route(/tile\.opentopomap\.org/, (route) =>
    route.fulfill({ contentType: "image/png", body: lightTile }),
  );
  await page.route(/basemaps\.cartocdn\.com/, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: route.request().url().includes("dark_all") ? darkTile : lightTile,
    }),
  );
}

const FIXED_WEATHER = {
  current: {
    temperature_2m: 24.5,
    weather_code: 1,
    wind_speed_10m: 8.2,
    relative_humidity_2m: 55,
  },
};

export async function stubApis(page: Page): Promise<void> {
  await page.route(/api\.open-meteo\.com/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(FIXED_WEATHER) }),
  );
  // Lazy enrichment (spec 19) returns nothing → panels render their stable,
  // data-only state instead of async-populating mid-screenshot.
  for (const host of [
    /nominatim\.openstreetmap\.org/,
    /api\.inaturalist\.org/,
    /\.wikipedia\.org/,
    /commons\.wikimedia\.org/,
    /\.wikimedia\.org/,
    /overpass/,
  ]) {
    await page.route(host, (route) => route.abort());
  }
}

/** Everything the visual suite needs before goto(). */
export async function deterministicPage(page: Page): Promise<void> {
  await stubTiles(page);
  await stubApis(page);
}

/**
 * Wait until the result list has finished loading its cells (spec 42 §E).
 *
 * Waiting for the "Loading peaks" status to DETACH raced: before React's first
 * render the status does not exist yet, so "detached" was already true and the
 * test went on to race the cell load — failing under machine load, passing
 * when idle (CON-VER-008). `aria-busy="false"` on #results exists only after
 * the list rendered AND loading ended, so it cannot be satisfied early. The
 * timeout bounds a hang; it is not a speed assertion. It sits under the 30 s
 * per-test timeout so a hang reports THIS wait, not a generic test timeout.
 */
export async function resultsLoaded(page: Page): Promise<void> {
  await page.locator('#results[aria-busy="false"]').waitFor({ state: "attached", timeout: 25_000 });
}

/**
 * Wait until the map's pins and clusters stop moving (spec 42 §E).
 *
 * This replaces a fixed 600 ms sleep, which a screenshot under load could beat:
 * clusters were captured mid-recompute (2026-10-10, mobile detail baseline).
 * It reads the on-screen position of every pin and cluster each 100 ms and
 * returns once five reads in a row are identical — a state ("stopped
 * changing"), measured at whatever speed the machine runs.
 */
export async function mapSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __mapSig?: string; __mapStable?: number };
      const sig = [...document.querySelectorAll(".trek-cluster, path.leaflet-interactive")]
        .map((e) => {
          const r = e.getBoundingClientRect();
          return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`;
        })
        .join("|");
      w.__mapStable = w.__mapSig === sig ? (w.__mapStable ?? 0) + 1 : 0;
      w.__mapSig = sig;
      return w.__mapStable >= 5;
    },
    undefined,
    { polling: 100, timeout: 20_000 },
  );
}

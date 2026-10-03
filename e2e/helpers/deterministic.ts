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

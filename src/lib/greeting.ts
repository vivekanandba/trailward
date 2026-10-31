/**
 * A line in the console for whoever opens it (spec 44 R15): where the data and
 * code come from, said once. No counts, which could disagree with what loaded.
 */
export const GREETING =
  "Trailward: summits across India, from open data (GeoNames, OpenStreetMap, Copernicus " +
  "elevation, ESA WorldCover, Open-Meteo). Code, data and issues: " +
  "https://github.com/vivekanandba/trailward";

let greeted = false;

/** Says the greeting the first time it is called (StrictMode mounts twice). */
export function greetOnce(): void {
  if (greeted) return;
  greeted = true;
  console.info(GREETING);
}

/** Test-only. */
export function resetGreetingForTest(): void {
  greeted = false;
}

/**
 * Device geolocation → Origin (spec 03/34). One shared implementation for the
 * header 📍 button, the stale-origin nudge, and silent refresh on load.
 *
 * The silent path NEVER triggers the browser permission prompt: it runs only
 * when the Permissions API reports "granted" (a returning user who already
 * said yes once). First-time users get the explicit, user-initiated flow.
 */
import type { Origin } from "./trek";

export function locateMe(
  geolocation: Geolocation | undefined = typeof navigator !== "undefined"
    ? navigator.geolocation
    : undefined,
): Promise<Origin> {
  return new Promise((resolvePos, reject) => {
    if (!geolocation) {
      reject(new Error("Location isn't available on this device."));
      return;
    }
    geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        resolvePos({
          id: `geo:${lat.toFixed(4)},${lng.toFixed(4)}`,
          name: "My location",
          lat,
          lng,
        });
      },
      () => reject(new Error("Couldn't get your location.")),
      { timeout: 10000, maximumAge: 60000 },
    );
  });
}

/** True when geolocation permission is ALREADY granted — safe to locate
 *  silently, no prompt possible. False when unknown/denied/unsupported. */
export async function geolocationGranted(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

/**
 * Says when the app is offline (spec 44 R14), promising only what spec 43's
 * cache holds today: the app itself, and the data of areas already opened on
 * this device (stale-while-revalidate). Area downloads are not built yet
 * (spec 43 §D), so nothing here claims them.
 *
 * Reads `navigator.onLine` at mount, because an installed app can open
 * already offline, when no `offline` event will ever fire. The live region
 * always exists, so the change is announced.
 */
import { useEffect, useState } from "react";

export default function OfflineNote() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  return (
    <p
      role="status"
      className={
        offline
          ? "bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          : "sr-only"
      }
    >
      {offline
        ? "You're offline. Areas you've already opened on this device still show their peaks; anything new, and photos, weather and the map background, needs a connection."
        : ""}
    </p>
  );
}

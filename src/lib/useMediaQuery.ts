/**
 * Reactive media query (spec 33). Defaults to TRUE when `matchMedia` is
 * missing so jsdom unit tests render the desktop branch — the breakpoint
 * split in App is JS-driven (FilterBar's input ids cannot exist twice).
 */
import { useEffect, useState } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Motion policy (spec 44 D2, D3; register rows 5 and 6). Every movement asks
 * here, so the rules live in one place:
 *
 * - **A still version always exists.** Under `prefers-reduced-motion` nothing
 *   moves: CSS is stilled by the global rule in index.css, and script-driven
 *   motion (Leaflet's pans and fits, the sheet's transform) asks
 *   `prefersReducedMotion()`, because no stylesheet reaches it.
 * - **No motion on load with no action behind it.** Until the person presses a
 *   key or a pointer, nothing animates: a `?sel=` deep link opens its panel in
 *   place, the sheet appears at its snap, the first map fit jumps.
 */

let acted = false;

/** Start watching for the first press. Idempotent per window. */
export function noteUserActions(win: Window = window): void {
  const mark = () => {
    acted = true;
  };
  // Capture, so a handler that stops propagation cannot hide the press.
  win.addEventListener("pointerdown", mark, { capture: true, once: true });
  win.addEventListener("keydown", mark, { capture: true, once: true });
}

/** True once the person has pressed a key or a pointer since load. */
export function userHasActed(): boolean {
  return acted;
}

/** Test-only: forget any press, as on a fresh load. */
export function resetUserActionsForTest(): void {
  acted = false;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Animate only in answer to something the person did, and never under reduced motion. */
export function shouldAnimate(): boolean {
  return userHasActed() && !prefersReducedMotion();
}

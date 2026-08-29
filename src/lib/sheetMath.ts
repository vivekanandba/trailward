/**
 * Pure snap-point maths for the bottom Sheet (spec 33) — extracted so the
 * gesture arithmetic is unit-testable without pointer events.
 *
 * Model: snap points are fractions of the viewport height the sheet REVEALS
 * (0.25 = quarter-screen peek). The sheet element is sized to the LARGEST
 * snap and positioned by translateY = (maxSnap − snap) × viewportPx.
 */

export function translateYFor(snap: number, maxSnap: number, viewportPx: number): number {
  return Math.max(0, (maxSnap - snap) * viewportPx);
}

/**
 * Where a drag should settle. `revealedPx` is the sheet height currently
 * visible when the pointer lifted; `velocityPxMs` is positive when flinging
 * UP (revealing more). A fling (|v| > 0.5 px/ms) advances one snap in the
 * fling direction from the CURRENT snap; a slow drag settles on the nearest
 * snap to where it was released. Returns the new snap INDEX, or "close" when
 * released clearly below the lowest snap (only when closable).
 */
export function settleSnap(
  snapPoints: number[],
  currentIdx: number,
  revealedPx: number,
  viewportPx: number,
  velocityPxMs: number,
  closable: boolean,
): number | "close" {
  const FLING = 0.5;
  if (velocityPxMs > FLING) return Math.min(snapPoints.length - 1, currentIdx + 1);
  if (velocityPxMs < -FLING) {
    if (currentIdx === 0) return closable ? "close" : 0;
    return currentIdx - 1;
  }
  const revealed = revealedPx / viewportPx;
  // Released well below the lowest snap → dismiss (when allowed).
  if (closable && revealed < snapPoints[0] * 0.6) return "close";
  let best = 0;
  for (let i = 1; i < snapPoints.length; i++) {
    if (Math.abs(snapPoints[i] - revealed) < Math.abs(snapPoints[best] - revealed)) best = i;
  }
  return best;
}

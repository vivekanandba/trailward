/**
 * Scrim (spec 33) — the frosted backdrop every overlay mounts over, so a
 * layer visibly separates from the busy terrain basemap behind it. Blocking
 * (mobile sheets: click closes) or purely visual (desktop detail panel:
 * pointerEvents none keeps pins clickable).
 */
export function Scrim({
  onClick,
  pointerEvents = true,
  className = "",
}: {
  onClick?: () => void;
  /** false → visual only; clicks fall through to the map beneath. */
  pointerEvents?: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid="scrim"
      aria-hidden="true"
      onClick={onClick}
      className={
        // Never on paper: a fixed scrim repeats over every printed page (spec 44 R5).
        "bg-black/30 backdrop-blur-[2px] transition-opacity duration-200 print:hidden " +
        `${pointerEvents ? "" : "pointer-events-none "}${className}`
      }
    />
  );
}

import type L from "leaflet";

type FitMap = Pick<L.Map, "flyToBounds" | "fitBounds" | "once" | "on" | "off">;

/**
 * How the map follows the results (spec 44 R4, R9). A new origin flies there
 * (0.8 s, allowed by name) after an action; anything else fits, animated only
 * after an action. The results for the new origin usually land mid-flight, and
 * a fit then would cancel the flight (Leaflet's setView stops it), so their fit
 * waits for the flight to end and then frames them, unless the person dragged
 * the map meanwhile (D3: their move wins).
 */
export function fitController(map: FitMap) {
  let flying = false;
  let pending: L.LatLngBounds | null = null;
  let dragged = false;
  const onDrag = () => {
    dragged = true;
  };
  return {
    fit(bounds: L.LatLngBounds, moved: boolean, animate: boolean): void {
      if (moved && animate) {
        flying = true;
        pending = null;
        dragged = false;
        map.on("dragstart", onDrag);
        map.once("moveend", () => {
          flying = false;
          map.off("dragstart", onDrag);
          if (pending && !dragged) map.fitBounds(pending, { padding: [24, 24], animate: true });
          pending = null;
        });
        map.flyToBounds(bounds, { padding: [24, 24], duration: 0.8 });
      } else if (flying) {
        pending = bounds;
      } else {
        map.fitBounds(bounds, { padding: [24, 24], animate });
      }
    },
  };
}

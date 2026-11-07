import { describe, it, expect } from "vitest";
import type L from "leaflet";
import { fitController } from "./fit";

// Spec 44 R9: the flight to a new origin must not be cut short by the fit
// that the new origin's results trigger when they land.
function fakeMap() {
  const calls: string[] = [];
  const handlers = new Map<string, Set<() => void>>();
  const on = (ev: string, fn: () => void) => {
    if (!handlers.has(ev)) handlers.set(ev, new Set());
    handlers.get(ev)!.add(fn);
  };
  const map = {
    calls,
    flyToBounds: () => void calls.push("fly"),
    fitBounds: (_b: unknown, o: { animate?: boolean }) => void calls.push(`fit:${o.animate}`),
    on,
    once: (ev: string, fn: () => void) => {
      const w = () => {
        handlers.get(ev)!.delete(w);
        fn();
      };
      on(ev, w);
    },
    off: (ev: string, fn: () => void) => void handlers.get(ev)?.delete(fn),
    emit: (ev: string) => [...(handlers.get(ev) ?? [])].forEach((f) => f()),
  };
  return map;
}
const b = {} as L.LatLngBounds;

describe("fitController", () => {
  it("lets the flight finish, then frames the results that landed during it", () => {
    const m = fakeMap();
    const f = fitController(m as never);
    f.fit(b, true, true); // a new origin, after a press
    f.fit(b, false, true); // its results land mid-flight
    expect(m.calls).toEqual(["fly"]); // not cut short
    m.emit("moveend");
    expect(m.calls).toEqual(["fly", "fit:true"]);
  });

  it("does not refit after the flight when the person dragged the map (D3)", () => {
    const m = fakeMap();
    const f = fitController(m as never);
    f.fit(b, true, true);
    f.fit(b, false, true);
    m.emit("dragstart");
    m.emit("moveend");
    expect(m.calls).toEqual(["fly"]);
  });

  it("jumps on load and fits directly when nothing is flying", () => {
    const m = fakeMap();
    const f = fitController(m as never);
    f.fit(b, false, false);
    f.fit(b, true, false); // a new origin before any press: no flight
    expect(m.calls).toEqual(["fit:false", "fit:false"]);
  });
});

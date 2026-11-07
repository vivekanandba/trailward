import { describe, it, expect } from "vitest";
import { compassPoint, sunTimes, toIstClock } from "./sun";
import usno from "./__fixtures__/usno-sun.json";

// Spec 44 R6: sunrise and sunset are computed, never looked up, and must agree
// with an independent reference. The fixture is the US Naval Observatory's
// published times at 8.5°, 21.1° and 34.2° N (the dataset spans 6.8–36.0° N)
// on both solstices and the March equinox, in IST.
const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

describe("sunTimes agrees with the US Naval Observatory to within 2 minutes", () => {
  for (const r of usno.rows) {
    it(`${r.place} on ${r.date}`, () => {
      const [y, m, d] = r.date.split("-").map(Number);
      const t = sunTimes(r.lat, r.lng, y, m, d);
      expect(t.kind).toBe("normal");
      if (t.kind !== "normal") return;
      expect(Math.abs(minutes(toIstClock(t.rise)) - minutes(r.rise))).toBeLessThanOrEqual(2);
      expect(Math.abs(minutes(toIstClock(t.set)) - minutes(r.set))).toBeLessThanOrEqual(2);
    });
  }
});

describe("where the sun rises and sets", () => {
  it("rises north of east in June and south of east in December, due east at the equinox", () => {
    const june = sunTimes(21.1458, 79.0882, 2026, 6, 21);
    const dec = sunTimes(21.1458, 79.0882, 2026, 12, 21);
    const mar = sunTimes(21.1458, 79.0882, 2026, 3, 20);
    if (june.kind !== "normal" || dec.kind !== "normal" || mar.kind !== "normal") throw new Error();
    expect(june.riseAzimuth).toBeLessThan(90);
    expect(dec.riseAzimuth).toBeGreaterThan(90);
    expect(Math.abs(mar.riseAzimuth - 90)).toBeLessThan(2);
    // Set mirrors rise across the meridian.
    expect(Math.abs(june.setAzimuth - (360 - june.riseAzimuth))).toBeLessThan(1);
  });

  it("names a compass point for a bearing", () => {
    expect(compassPoint(0)).toBe("north");
    expect(compassPoint(67)).toBe("east-northeast");
    expect(compassPoint(90)).toBe("east");
    expect(compassPoint(115)).toBe("east-southeast");
    expect(compassPoint(293)).toBe("west-northwest");
    expect(compassPoint(359)).toBe("north");
  });
});

describe("no sunrise at all", () => {
  it("reports midnight sun and polar night instead of inventing a time", () => {
    expect(sunTimes(80, 0, 2026, 6, 21).kind).toBe("always-up");
    expect(sunTimes(80, 0, 2026, 12, 21).kind).toBe("always-down");
  });
});

describe("toIstClock", () => {
  it("writes a UTC instant as an IST wall clock", () => {
    expect(toIstClock(new Date("2026-06-21T00:35:00Z"))).toBe("06:05");
    expect(toIstClock(new Date("2026-06-21T18:45:00Z"))).toBe("00:15");
  });
});

import { describe, it, expect } from "vitest";
import { toGpx } from "./gpx";
import type { Trek } from "./trek";

const base: Trek = {
  id: "puligundu",
  name: "Puligundu",
  lat: 13.3417,
  lng: 79.2032,
  cityId: "bangalore",
  tier: "discovery",
  sources: [],
  verified: false,
};

describe("toGpx", () => {
  it("emits a valid GPX 1.1 waypoint at the coords", () => {
    const gpx = toGpx(base);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain('<wpt lat="13.3417" lon="79.2032">');
    expect(gpx).toContain("<name>Puligundu</name>");
    expect(gpx.trim().endsWith("</gpx>")).toBe(true);
  });

  it("includes <ele> only when elevation is known", () => {
    expect(toGpx(base)).not.toContain("<ele>");
    expect(toGpx({ ...base, elevationM: 914 })).toContain("<ele>914</ele>");
  });

  it("XML-escapes the name", () => {
    expect(toGpx({ ...base, name: 'Peak <a> & "b"' })).toContain(
      "<name>Peak &lt;a&gt; &amp; &quot;b&quot;</name>",
    );
  });

  it("adds a <trk> when a trail is attached", () => {
    const gpx = toGpx({
      ...base,
      trail: {
        coords: [
          [13.34, 79.2],
          [13.341, 79.201],
        ],
        lengthKm: 1.2,
        gainM: 80,
      },
    });
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain('<trkpt lat="13.34" lon="79.2" />');
    expect(gpx).toContain('<trkpt lat="13.341" lon="79.201" />');
  });

  it("omits the <trk> when there is no trail", () => {
    expect(toGpx(base)).not.toContain("<trk>");
  });
});

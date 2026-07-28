import { describe, it, expect } from "vitest";
import {
  parseDms,
  parseCoords,
  parseElevationFt,
  excerpt,
  parseGazetteerEntries,
  matchEntries,
  nameKey,
  elevationsAgree,
  type GazetteerEntry,
} from "./gazetteer";

// Real text shapes taken from the Imperial Gazetteer of India (1908), Vol. XXI,
// including its OCR quirks.
const RAMANDRUG = `
Ramandrug.—Sanitarium of Bellary, situated in 15° 8' N. and 76° 30' E., within
the limits of the Native State of Sandur, attached to the Madras Presidency.
The sanitarium consists of a small plateau on the top of the southern of the two
ranges of hill which enclose the valley of Sandur. It is 3,256 feet above sea
level, and the climate is pleasant.
`;

const PUTTUR_ADMIN = `
Puttur Tahsil.—Zamindari tahsil in North Arcot District, Madras, consisting of
the northern half of the Karvetnagar zamindari. Area, 542 square miles.
`;

describe("parseDms", () => {
  it("converts degrees + minutes to decimal", () => {
    expect(parseDms("15", "8", "N", 90)).toBeCloseTo(15.1333, 3);
    expect(parseDms("76", "30", "E", 180)).toBeCloseTo(76.5, 3);
  });

  it("negates southern/western hemispheres", () => {
    expect(parseDms("15", "30", "S", 90)).toBeCloseTo(-15.5, 3);
    expect(parseDms("76", "0", "W", 180)).toBeCloseTo(-76, 3);
  });

  it("repairs OCR'd minutes and tolerates missing ones", () => {
    expect(parseDms("15", "3o", "N", 90)).toBeCloseTo(15.5, 3); // 'o' → 0
    expect(parseDms("15", undefined, "N", 90)).toBe(15);
  });

  it("rejects out-of-range degrees and treats bad minutes as zero", () => {
    expect(parseDms("99", "0", "N", 90)).toBeUndefined();
    expect(parseDms("15", "99", "N", 90)).toBe(15); // implausible minutes dropped
  });
});

describe("parseCoords", () => {
  it("pulls a lat/lng pair out of gazetteer prose", () => {
    const c = parseCoords(RAMANDRUG)!;
    expect(c.lat).toBeCloseTo(15.133, 2);
    expect(c.lng).toBeCloseTo(76.5, 2);
  });

  it("rejects coordinates outside the subcontinent (OCR guard)", () => {
    expect(parseCoords("situated in 65° 0' N. and 12° 0' E.")).toBeUndefined();
  });

  it("returns undefined when there is no coordinate", () => {
    expect(parseCoords(PUTTUR_ADMIN)).toBeUndefined();
  });
});

describe("parseElevationFt", () => {
  it("reads a comma-grouped elevation in feet", () => {
    expect(parseElevationFt(RAMANDRUG)).toBe(3256);
  });

  it("ignores implausible or absent values", () => {
    expect(parseElevationFt("about 12 feet wide")).toBeUndefined();
    expect(parseElevationFt("no elevation here")).toBeUndefined();
  });
});

describe("excerpt", () => {
  it("collapses whitespace and de-hyphenates across line breaks", () => {
    expect(excerpt("a  ridge en-\nclosing the val-\nley .")).toBe("a ridge enclosing the valley.");
  });

  it("cuts at a sentence boundary rather than mid-word", () => {
    const long = "First sentence here. " + "x".repeat(400);
    expect(excerpt(long, 100)).toBe("First sentence here.");
  });

  it("leaves short text untouched", () => {
    expect(excerpt("Short note.")).toBe("Short note.");
  });
});

describe("parseGazetteerEntries", () => {
  it("extracts a coordinate-bearing summit entry with its elevation", () => {
    const entries = parseGazetteerEntries(RAMANDRUG);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Ramandrug");
    expect(entries[0].lat).toBeCloseTo(15.133, 2);
    expect(entries[0].elevationFt).toBe(3256);
    expect(entries[0].text).toContain("Sanitarium of Bellary");
  });

  it("skips administrative entries (districts, tahsils, villages)", () => {
    expect(parseGazetteerEntries(PUTTUR_ADMIN)).toHaveLength(0);
  });

  it("skips entries with no parseable coordinate — never matches on name alone", () => {
    const noCoord = "\nSomehill.—A hill in the north of the district, wooded and steep.\n";
    expect(parseGazetteerEntries(noCoord)).toHaveLength(0);
  });

  it("handles several entries in one volume", () => {
    const entries = parseGazetteerEntries(RAMANDRUG + "\n" + PUTTUR_ADMIN + RAMANDRUG);
    expect(entries.map((e) => e.name)).toEqual(["Ramandrug", "Ramandrug"]);
  });
});

describe("nameKey", () => {
  it("strips diacritics, generic words, and punctuation", () => {
    expect(nameKey("Ramandrug")).toBe("ramandrug");
    expect(nameKey("Ratnagiri Hill")).toBe("ratnagiri");
    expect(nameKey("Devarā Betta")).toBe("devara");
  });
});

describe("matchEntries", () => {
  const entry: GazetteerEntry = {
    name: "Ramandrug",
    lat: 15.133,
    lng: 76.5,
    elevationFt: 3256,
    text: "Sanitarium of Bellary…",
  };

  it("matches when the name AND the coordinate agree", () => {
    const m = matchEntries([entry], [{ id: "t1", name: "Ramandrug", lat: 15.14, lng: 76.51 }]);
    expect(m.get("t1")?.name).toBe("Ramandrug");
  });

  it("refuses a name match that is far away (proximity is required)", () => {
    const m = matchEntries([entry], [{ id: "t1", name: "Ramandrug", lat: 12.0, lng: 77.0 }]);
    expect(m.size).toBe(0);
  });

  it("refuses a nearby peak with a different name (name is required)", () => {
    const m = matchEntries([entry], [{ id: "t1", name: "Someotherhill", lat: 15.14, lng: 76.51 }]);
    expect(m.size).toBe(0);
  });

  it("allows a prefix match on longer local names", () => {
    const m = matchEntries(
      [{ ...entry, name: "Nandidurga" }],
      [{ id: "t1", name: "Nandidurga Hill", lat: 15.14, lng: 76.51 }],
    );
    expect(m.get("t1")).toBeTruthy();
  });

  it("keeps the nearest entry when several match one trek", () => {
    const near: GazetteerEntry = { ...entry, lat: 15.141, lng: 76.511, text: "nearer" };
    const m = matchEntries(
      [entry, near],
      [{ id: "t1", name: "Ramandrug", lat: 15.14, lng: 76.51 }],
    );
    expect(m.get("t1")?.text).toBe("nearer");
  });
});

describe("elevationsAgree (third independent check)", () => {
  it("accepts the 1908 survey when it matches our DEM", () => {
    expect(elevationsAgree(4851, 1478)).toBe(true); // Nandi Hills: 1 m apart
    expect(elevationsAgree(4024, 1226)).toBe(true); // Savandurga
    expect(elevationsAgree(3022, 870)).toBe(true); // 51 m apart — still plausible
  });

  it("rejects a same-name hill at a wildly different height", () => {
    expect(elevationsAgree(4851, 400)).toBe(false);
  });

  it("has no opinion when either elevation is unknown", () => {
    expect(elevationsAgree(undefined, 1478)).toBe(true);
    expect(elevationsAgree(4851, undefined)).toBe(true);
  });

  it("is enforced by matchEntries", () => {
    const e: GazetteerEntry = { name: "Tallhill", lat: 15, lng: 76, elevationFt: 4851, text: "x" };
    const near = { id: "t1", name: "Tallhill", lat: 15.01, lng: 76.01 };
    expect(matchEntries([e], [{ ...near, elevationM: 1478 }]).size).toBe(1);
    expect(matchEntries([e], [{ ...near, elevationM: 300 }]).size).toBe(0);
  });
});

describe("excerpt drops the OCR'd coordinate clause", () => {
  it("removes 'situated in …E.' so mangled degree symbols never reach the reader", () => {
    const raw =
      "A conspicuous fortified hill, 4,024 feet high, in the west of Bangalore District, " +
      "Mysore, situated in 12° 55^ N. and 77® 18' E. It is an enormous bare dome-shaped mass.";
    const out = excerpt(raw);
    expect(out).not.toMatch(/situated in/i);
    expect(out).not.toMatch(/[®^]/);
    expect(out).toContain("A conspicuous fortified hill, 4,024 feet high");
    expect(out).toContain("enormous bare dome-shaped mass");
  });
});

describe("excerpt handles the comma-terminated coordinate OCR variant", () => {
  it("strips 'situated in … E,' (comma, not full stop)", () => {
    const raw =
      "Hill in the Molakalmuru taluk of Chitaldroog District, Mysore, situated in 14° 48' N. " +
      "and 76° 49' E, Here, in 1892, were discovered Asoka edicts engraved on a great boulder.";
    const out = excerpt(raw);
    expect(out).not.toMatch(/situated in/i);
    expect(out).toContain("Asoka edicts");
  });
});

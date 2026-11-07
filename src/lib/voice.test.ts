import { describe, it, expect } from "vitest";
import { regionSentence, seasonSentence, sunSentence } from "./voice";
import type { RegionStats } from "./regionStats";

// Spec 44 R6–R8 and rule D1: every sentence is built from fields we hold or
// arithmetic on them; a missing input drops its clause, never fills it.
const BAD = /undefined|NaN|null|\s,|,\s*[.;]|\band\s*[.;]|\s{2,}|^\s|\s$|\(\s*\)/;

describe("sunSentence", () => {
  it("gives both times in IST and where the sun comes up", () => {
    const s = sunSentence({
      kind: "normal",
      rise: new Date("2026-06-21T00:35:00Z"),
      set: new Date("2026-06-21T13:13:00Z"),
      riseAzimuth: 66,
      setAzimuth: 294,
    });
    expect(s).toBe(
      "Sunrise 06:05 and sunset 18:43 today (IST); the sun comes up in the east-northeast.",
    );
  });

  it("says so plainly when the sun does not cross the horizon", () => {
    expect(sunSentence({ kind: "always-up" })).toBe("The sun does not set here today.");
    expect(sunSentence({ kind: "always-down" })).toBe("The sun does not rise here today.");
  });
});

describe("seasonSentence", () => {
  it("never calls a dry month outside the longest dry run 'wetter' (rule D1)", () => {
    // Climate cell 41:308: December (80 mm) is under the 85.6 mm threshold,
    // but the longest dry run is Feb–Mar.
    const cell = [120, 18, 28, 87, 201, 169, 415, 351, 186, 198, 204, 80];
    expect(seasonSentence(cell, 11)).toBe(
      "Now is one of the drier months here; the longest dry stretch is Feb–Mar, going by rainfall.",
    );
    expect(seasonSentence(cell, 6)).toMatch(/^Now is the wetter part of the year here/);
    expect(seasonSentence(cell, 1)).toMatch(/^Now is the drier stretch here \(Feb–Mar\)/);
  });

  // Bengaluru-like. Dry months are under half the 79.8 mm monthly mean, so April
  // (40 mm) is just outside: the drier stretch is Dec–Mar.
  const rain = [5, 8, 15, 40, 110, 90, 110, 140, 190, 170, 60, 20];

  it("says when now is in the drier stretch", () => {
    expect(seasonSentence(rain, 0)).toBe(
      "Now is the drier stretch here (Dec–Mar), going by rainfall.",
    );
  });

  it("says when now is the wetter part, and names the drier stretch", () => {
    expect(seasonSentence(rain, 8)).toBe(
      "Now is the wetter part of the year here; the drier stretch is Dec–Mar, going by rainfall.",
    );
  });

  it("says nothing without a clear dry season or with malformed data", () => {
    expect(seasonSentence(Array(12).fill(100), 0)).toBeUndefined();
    expect(seasonSentence([1, 2, 3], 0)).toBeUndefined();
    expect(seasonSentence(undefined, 0)).toBeUndefined();
  });
});

describe("regionSentence", () => {
  const full: RegionStats = {
    count: 601,
    spread: { Easy: 324, Moderate: 232, Hard: 45 },
    highestM: 1712,
    maxReliefM: 373,
    topGem: { name: "Kumbārachi Kallu", score: 0.92 },
  };

  it("reads as a sentence about the place", () => {
    expect(regionSentence(full, "Bengaluru")).toBe(
      "601 peaks around Bengaluru, most of them easy; the highest stands at 1712 m, and the top hidden gem is Kumbārachi Kallu.",
    );
  });

  it("calls a spread with no majority a mix", () => {
    const mixed = { ...full, spread: { Easy: 10, Moderate: 10, Hard: 9 } };
    expect(regionSentence(mixed, "Pune")).toMatch(
      /^601 peaks around Pune, a mix of easy, moderate and hard;/,
    );
  });

  it("never leads a clause with an Unnamed peak", () => {
    const s = regionSentence(
      { ...full, topGem: { name: "Unnamed peak (~912 m)", score: 0.9 } },
      "X",
    );
    expect(s).not.toMatch(/Unnamed/);
    expect(s).toMatch(/1712 m\.$/);
  });

  it("is singular for one peak", () => {
    expect(regionSentence({ count: 1, spread: { Easy: 0, Moderate: 0, Hard: 0 } }, "X")).toBe(
      "1 peak around X.",
    );
  });

  it("drops each missing clause cleanly, in every combination (D1)", () => {
    const optional = ["highestM", "maxReliefM", "topGem"] as const;
    for (let mask = 0; mask < 1 << optional.length; mask++) {
      const s: RegionStats = { ...full };
      optional.forEach((k, i) => {
        if (mask & (1 << i)) delete s[k];
      });
      for (const spread of [full.spread, { Easy: 0, Moderate: 0, Hard: 0 }]) {
        const out = regionSentence({ ...s, spread }, "Bengaluru");
        expect(out, JSON.stringify({ mask, spread })).not.toMatch(BAD);
        expect(out).toMatch(/\.$/);
      }
    }
  });
});

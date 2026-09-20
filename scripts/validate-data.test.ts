import { describe, it, expect } from "vitest";
import { runValidateData } from "./validate-data";
import { memoryIO } from "./lib/buildIO";

const P = "/repo/src/data/treks.json";
const valid = [
  {
    id: "skandagiri",
    name: "Skandagiri",
    lat: 13.5,
    lng: 77.69,
    tier: "curated",
    sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
    verified: true,
  },
];

describe("validate-data run (spec 01/40 — the deploy gate)", () => {
  it("accepts a valid dataset and reports the count it actually validated", () => {
    const io = memoryIO({ [P]: JSON.stringify(valid) });
    expect(runValidateData(io, P)).toBe(1);
    expect(io.logs.join()).toContain("1 trek record");
  });

  it("fails when the dataset is missing — not silently zero records", () => {
    expect(() => runValidateData(memoryIO(), P)).toThrow(/missing/i);
  });

  it("fails on unparseable JSON, naming the file", () => {
    expect(() => runValidateData(memoryIO({ [P]: "{oops" }), P)).toThrow(/not valid JSON/i);
  });

  it("fails on an invalid record, surfacing the validator's reason", () => {
    const bad = [{ ...valid[0], lat: 999 }];
    expect(() => runValidateData(memoryIO({ [P]: JSON.stringify(bad) }), P)).toThrow(/lat/);
  });

  it("fails on duplicate ids — two records claiming one summit", () => {
    const dupes = [valid[0], { ...valid[0] }];
    expect(() => runValidateData(memoryIO({ [P]: JSON.stringify(dupes) }), P)).toThrow(
      /duplicate/i,
    );
  });
});

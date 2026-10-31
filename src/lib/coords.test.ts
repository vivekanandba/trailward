import { describe, it, expect } from "vitest";
import { toDms } from "./coords";

// Spec 44 R5: a printed card carries coordinates a person can type into a GPS
// or read to someone over the phone.
describe("toDms", () => {
  it("writes degrees, minutes and seconds with the hemisphere", () => {
    // Skandagiri: 13.4192 N, 77.6836 E
    expect(toDms(13.4192, 77.6836)).toBe("13°25′09″N 77°41′01″E");
  });

  it("uses S and W for negative values", () => {
    expect(toDms(-33.8568, -70.6693)).toBe("33°51′24″S 70°40′09″W");
  });

  it("carries 60 seconds into the next minute, and 60 minutes into the next degree", () => {
    expect(toDms(12.99999, 77.5)).toBe("13°00′00″N 77°30′00″E");
    expect(toDms(10.0166666, 0)).toBe("10°01′00″N 0°00′00″E");
  });

  it("is zero-padded so columns line up on a printed page", () => {
    expect(toDms(8.0025, 76.9)).toBe("8°00′09″N 76°54′00″E");
  });
});

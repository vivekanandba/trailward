import { describe, it, expect } from "vitest";
import {
  climateCellKey,
  driestMonths,
  bestSeasonFrom,
  wettestMonth,
  CLIMATE_CELL_DEG,
} from "./climate";

// Real sampled profiles (mean mm/month, Jan→Dec) from the Open-Meteo archive.
const SAVANDURGA = [3, 0, 8, 35, 147, 105, 193, 154, 152, 114, 83, 36]; // Deccan, moderate
const COASTAL_KERALA = [9, 15, 70, 256, 534, 477, 622, 439, 400, 320, 263, 117]; // Ghats, very wet
const ARID = [4, 2, 3, 6, 9, 12, 20, 18, 10, 5, 3, 2]; // little rain all year

describe("climateCellKey", () => {
  it("groups nearby coordinates into one cell and separates distant ones", () => {
    expect(climateCellKey(12.92, 77.29)).toBe(climateCellKey(12.93, 77.3));
    expect(climateCellKey(12.92, 77.29)).not.toBe(climateCellKey(13.6, 77.29));
  });

  it("keys by floored grid index at the documented resolution", () => {
    expect(CLIMATE_CELL_DEG).toBe(0.25);
    expect(climateCellKey(0.3, 0.6)).toBe("1:2");
  });
});

describe("driestMonths", () => {
  it("finds the dry stretch wrapping December→January", () => {
    const dry = driestMonths(SAVANDURGA);
    // Dec(36), Jan(3), Feb(0), Mar(8), Apr(35) all sit below half the mean.
    expect(dry).toEqual([11, 0, 1, 2, 3]);
  });

  it("handles a very wet monsoon climate", () => {
    expect(driestMonths(COASTAL_KERALA)).toEqual([11, 0, 1, 2]); // Dec–Mar
  });

  it("treats an arid climate as dry all year", () => {
    expect(driestMonths(ARID)).toHaveLength(12);
  });

  it("returns nothing for malformed input", () => {
    expect(driestMonths([1, 2, 3])).toEqual([]);
    expect(driestMonths(Array(12).fill(NaN))).toEqual([]);
  });
});

describe("bestSeasonFrom", () => {
  it("formats the driest stretch honestly", () => {
    expect(bestSeasonFrom(SAVANDURGA)).toBe("Dec–Apr (driest)");
    expect(bestSeasonFrom(COASTAL_KERALA)).toBe("Dec–Mar (driest)");
  });

  it("reports year-round for an arid climate", () => {
    expect(bestSeasonFrom(ARID)).toBe("Year-round (little rain)");
  });

  it("returns undefined when there's no usable profile", () => {
    expect(bestSeasonFrom([])).toBeUndefined();
  });
});

describe("wettestMonth", () => {
  it("identifies the peak-monsoon month", () => {
    expect(wettestMonth(SAVANDURGA)).toEqual({ month: "Jul", mm: 193 });
    expect(wettestMonth(COASTAL_KERALA)).toEqual({ month: "Jul", mm: 622 });
  });
});

import { describe, it, expect, vi } from "vitest";
import { parseMonthlyRain, parseArchiveBatch, fetchMonthlyRain, BATCH } from "./climate";

// Two years of daily values, 1 mm every day → each month = its day count.
function twoYearsOfDaily(mmPerDay = 1): { time: string[]; precipitation_sum: number[] } {
  const time: string[] = [];
  const precipitation_sum: number[] = [];
  for (const year of [2022, 2023]) {
    for (let m = 1; m <= 12; m++) {
      const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
      for (let d = 1; d <= days; d++) {
        time.push(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
        precipitation_sum.push(mmPerDay);
      }
    }
  }
  return { time, precipitation_sum };
}

describe("parseMonthlyRain", () => {
  it("aggregates daily totals into 12 per-year monthly means", () => {
    const out = parseMonthlyRain({ daily: twoYearsOfDaily(1) })!;
    expect(out).toHaveLength(12);
    expect(out[0]).toBeCloseTo(31, 1); // January: 31 days × 1 mm
    expect(out[1]).toBeCloseTo(28, 0); // February (2022 non-leap, 2023 non-leap)
    expect(out[3]).toBeCloseTo(30, 1); // April
  });

  it("ignores non-finite readings rather than poisoning the total", () => {
    const out = parseMonthlyRain(
      { daily: { time: ["2022-01-01", "2022-01-02"], precipitation_sum: [5, null] } },
      1,
    )!;
    expect(out[0]).toBe(5);
  });

  it("returns undefined for unusable series", () => {
    expect(parseMonthlyRain({})).toBeUndefined();
    expect(
      parseMonthlyRain({ daily: { time: ["2022-01-01"], precipitation_sum: [] } }),
    ).toBeUndefined();
    expect(parseMonthlyRain({ daily: { time: [], precipitation_sum: [] } })).toBeUndefined();
  });
});

describe("parseArchiveBatch", () => {
  it("handles a multi-location array and a single-object response alike", () => {
    const one = { daily: twoYearsOfDaily(1) };
    expect(parseArchiveBatch([one, one])).toHaveLength(2);
    expect(parseArchiveBatch(one)).toHaveLength(1);
  });

  it("maps an unusable location to undefined, keeping index alignment", () => {
    const batch = parseArchiveBatch([{ daily: twoYearsOfDaily(1) }, {}]);
    expect(batch[0]).toBeDefined();
    expect(batch[1]).toBeUndefined();
  });
});

describe("fetchMonthlyRain", () => {
  const cells = Array.from({ length: BATCH + 3 }, (_, i) => ({
    key: `k${i}`,
    lat: 12 + i * 0.25,
    lng: 77,
  }));

  it("batches requests and keys results by cell", async () => {
    const getJson = vi.fn(async (url: string) => {
      const n = url.split("latitude=")[1].split("&")[0].split(",").length;
      return Array.from({ length: n }, () => ({ daily: twoYearsOfDaily(1) }));
    });
    const out = await fetchMonthlyRain(cells, getJson);
    expect(out.size).toBe(cells.length);
    expect(getJson).toHaveBeenCalledTimes(2); // BATCH + 3 → two requests
    expect(out.get("k0")?.[0]).toBeCloseTo(31, 1);
  });

  it("skips a failed batch instead of aborting the whole build", async () => {
    const getJson = vi.fn(async (url: string) => {
      if (url.includes("latitude=12.0000")) throw new Error("429");
      const n = url.split("latitude=")[1].split("&")[0].split(",").length;
      return Array.from({ length: n }, () => ({ daily: twoYearsOfDaily(1) }));
    });
    const out = await fetchMonthlyRain(cells, getJson);
    expect(out.size).toBe(3); // only the second batch survived
    expect(out.has("k0")).toBe(false);
  });
});

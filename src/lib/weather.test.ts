import { describe, it, expect, vi, afterEach } from "vitest";
import { getWeather, parseWeather, weatherSummary } from "./weather";

const fixture = {
  current: { temperature_2m: 24.5, weather_code: 2 },
  daily: {
    time: ["2026-06-06", "2026-06-07", "2026-06-08"],
    weather_code: [2, 61, 0],
    temperature_2m_max: [30, 28, 31],
    temperature_2m_min: [20, 19, 21],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("weatherSummary (WMO codes)", () => {
  it("maps known codes to human text", () => {
    expect(weatherSummary(0)).toMatch(/clear/i);
    expect(weatherSummary(61)).toMatch(/rain/i);
  });

  it("falls back gracefully for unknown codes", () => {
    expect(weatherSummary(999)).toBeTruthy();
  });
});

describe("parseWeather (pure)", () => {
  it("extracts current conditions and a 3-day outlook", () => {
    const w = parseWeather(fixture);
    expect(w.tempC).toBe(24.5);
    expect(w.code).toBe(2);
    expect(w.summary).toBeTruthy();
    expect(w.next3d).toHaveLength(3);
    expect(w.next3d[0]).toMatchObject({ date: "2026-06-06", maxC: 30, minC: 20, code: 2 });
  });
});

describe("getWeather (fetch wrapper)", () => {
  it("fetches Open-Meteo and returns parsed conditions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture });
    vi.stubGlobal("fetch", fetchMock);

    const w = await getWeather(13.5, 77.69);
    expect(fetchMock.mock.calls[0][0]).toContain("api.open-meteo.com");
    expect(w.tempC).toBe(24.5);
  });

  it("rejects on a failed request so the caller can degrade", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(getWeather(13.5, 77.69)).rejects.toThrow();
  });
});

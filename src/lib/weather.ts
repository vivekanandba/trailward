// Live weather via Open-Meteo (spec 06). Free, no key. Optional in the detail
// card: getWeather rejects on failure and the caller renders without it.
export interface DayForecast {
  date: string;
  code: number;
  maxC: number;
  minC: number;
}

export interface WeatherNow {
  tempC: number;
  code: number;
  summary: string;
  next3d: DayForecast[];
}

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// WMO weather interpretation codes → short human text (grouped by family).
export function weatherSummary(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 2) return "Mostly clear";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return "Unknown";
}

/** Pure parser: Open-Meteo JSON → WeatherNow. */
export function parseWeather(json: unknown): WeatherNow {
  const data = json as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };
  const code = data.current?.weather_code ?? 0;
  const daily = data.daily ?? {};
  const next3d: DayForecast[] = (daily.time ?? []).slice(0, 3).map((date, i) => ({
    date,
    code: daily.weather_code?.[i] ?? 0,
    maxC: daily.temperature_2m_max?.[i] ?? NaN,
    minC: daily.temperature_2m_min?.[i] ?? NaN,
  }));

  return {
    tempC: data.current?.temperature_2m ?? NaN,
    code,
    summary: weatherSummary(code),
    next3d,
  };
}

/** Fetch current + 3-day weather for a point. Rejects on network/HTTP failure. */
export async function getWeather(lat: number, lng: number): Promise<WeatherNow> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "3",
    timezone: "auto",
  });
  const res = await fetch(`${OPEN_METEO_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`weather request failed: ${res.status}`);
  return parseWeather(await res.json());
}

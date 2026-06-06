import { useEffect, useState } from "react";
import type { Origin, Trek } from "../lib/trek";
import { distanceFrom } from "../lib/distance";
import { difficultyColor, difficultyLabel } from "../lib/difficulty";
import { googleMapsDirectionsUrl } from "../lib/directions";
import { getWeather, type WeatherNow } from "../lib/weather";

interface TrekDetailProps {
  trek: Trek;
  origin: Origin;
  onClose(): void;
}

// Safe hostname for a source link; falls back to the raw string if the URL is
// malformed, so one bad source never blanks the panel (spec 00).
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

// One labelled fact row; renders nothing when the value is absent (spec 06).
function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-trail-600">{label}</dt>
      <dd className="text-right font-medium text-trail-900">{value}</dd>
    </div>
  );
}

export default function TrekDetail({ trek, origin, onClose }: TrekDetailProps) {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [weatherFailed, setWeatherFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setWeather(null);
    setWeatherFailed(false);
    getWeather(trek.lat, trek.lng)
      .then((w) => active && setWeather(w))
      .catch(() => active && setWeatherFailed(true));
    return () => {
      active = false;
    };
  }, [trek.id, trek.lat, trek.lng]);

  const km = Math.round(trek.distanceKm ?? distanceFrom(origin, trek));
  const color = difficultyColor(trek.difficulty);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-trail-100 p-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-trail-900">{trek.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: color }}
            >
              {difficultyLabel(trek.difficulty)}
            </span>
            {trek.tier === "discovery" && (
              <span className="rounded-full bg-difficulty-discovery px-2 py-0.5 text-xs font-medium text-white">
                community · unverified
              </span>
            )}
            {trek.type?.map((t) => (
              <span
                key={t}
                className="rounded-full border border-trail-200 bg-trail-50 px-2 py-0.5 text-xs text-trail-700"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-md p-1 text-trail-500 hover:bg-trail-50"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {trek.highlights && <p className="text-sm text-trail-700">{trek.highlights}</p>}

        <dl className="mt-3 divide-y divide-trail-50">
          <Fact label={`Distance from ${origin.name}`} value={`~${km} km`} />
          <Fact label="Elevation" value={trek.elevationM ? `${trek.elevationM} m` : undefined} />
          <Fact label="Best season" value={trek.bestSeason} />
          <Fact
            label="Trail length"
            value={trek.trailLengthKm ? `${trek.trailLengthKm} km` : undefined}
          />
          <Fact label="Duration" value={trek.durationHrs ? `${trek.durationHrs} h` : undefined} />
          <Fact label="Nearest town" value={trek.nearestTown} />
          <Fact label="Entry fee" value={trek.entryFee} />
          <Fact
            label="Permit"
            value={
              trek.permitRequired === undefined
                ? undefined
                : trek.permitRequired
                  ? "Required"
                  : "Not required"
            }
          />
          <Fact label="Night trek" value={trek.nightTrek ? "Popular" : undefined} />
        </dl>

        {/* Weather (optional, fills in or degrades silently) */}
        {weather && (
          <div className="mt-4 rounded-lg bg-trail-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-trail-800">Weather now</span>
              <span className="text-sm text-trail-700">
                {Math.round(weather.tempC)}°C · {weather.summary}
              </span>
            </div>
            {weather.next3d.length > 0 && (
              <div className="mt-2 flex gap-3 text-xs text-trail-600">
                {weather.next3d.map((d) => (
                  <span key={d.date} className="tabular-nums">
                    {Math.round(d.minC)}–{Math.round(d.maxC)}°
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {weatherFailed && (
          <p className="mt-4 text-xs text-trail-500">Weather unavailable right now.</p>
        )}
      </div>

      <div className="border-t border-trail-100 p-4">
        <a
          href={googleMapsDirectionsUrl(origin, trek)}
          target="_blank"
          rel="noreferrer"
          className="block w-full rounded-lg bg-trail-600 py-2 text-center text-sm font-medium text-white hover:bg-trail-700"
        >
          Directions
        </a>
        {trek.sources.length > 0 && (
          <div className="mt-3 text-xs text-trail-600">
            Sources:{" "}
            {trek.sources.map((url, i) => (
              <span key={url}>
                {i > 0 && ", "}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-trail-800"
                >
                  {hostnameOf(url)}
                </a>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

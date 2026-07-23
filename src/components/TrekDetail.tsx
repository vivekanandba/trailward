import { useEffect, useState } from "react";
import type { Origin, Trek } from "../lib/trek";
import { distanceFrom } from "../lib/distance";
import { difficultyColor, difficultyLabel } from "../lib/difficulty";
import { googleMapsDirectionsUrl } from "../lib/directions";
import { getWeather, type WeatherNow } from "../lib/weather";
import { toGpx } from "../lib/gpx";

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

// Split an attribution string into leading text + a trailing URL (if any) so
// the credit can link to the license/file page. Falls back to plain text.
function splitAttribution(attribution: string): { text: string; url?: string } {
  const m = attribution.match(/(https?:\/\/\S+)\s*$/);
  if (!m) return { text: attribution };
  return {
    text: attribution
      .slice(0, m.index)
      .replace(/[—\-:\s]+$/, "")
      .trim(),
    url: m[1],
  };
}

// One labelled fact row; renders nothing when the value is absent (spec 06).
function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-trail-600 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-trail-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

// A single-series area sparkline of the trail's elevation profile (spec 14).
// One brand hue via currentColor (theme-aware); the numbers live as Facts above,
// so this is the visual layer, not the sole source of the data.
function ElevationProfile({ trail }: { trail: NonNullable<Trek["trail"]> }) {
  const prof = trail.profile;
  if (!prof || prof.length < 2 || trail.coords.length !== prof.length) return null;

  const dist = [0];
  for (let i = 1; i < trail.coords.length; i++) {
    const [aLat, aLng] = trail.coords[i - 1];
    const [bLat, bLng] = trail.coords[i];
    dist.push(
      dist[i - 1] +
        distanceFrom({ id: "", name: "", lat: aLat, lng: aLng }, { lat: bLat, lng: bLng }),
    );
  }
  const W = 300;
  const H = 72;
  const pad = 4;
  const maxD = dist[dist.length - 1] || 1;
  const minE = Math.min(...prof);
  const maxE = Math.max(...prof);
  const span = maxE - minE || 1;
  const px = (d: number) => pad + (d / maxD) * (W - 2 * pad);
  const py = (e: number) => pad + (1 - (e - minE) / span) * (H - 2 * pad);
  const pts = prof.map((e, i) => `${px(dist[i]).toFixed(1)},${py(e).toFixed(1)}`);
  const line = `M ${pts.join(" L ")}`;
  const area = `M ${px(0).toFixed(1)},${H - pad} L ${pts.join(" L ")} L ${px(maxD).toFixed(1)},${H - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-2 h-16 w-full text-trail-600 dark:text-trail-300"
      role="img"
      aria-label={`Elevation profile: ${Math.round(minE)}–${Math.round(maxE)} m over ~${trail.lengthKm} km`}
    >
      <path d={area} fill="currentColor" fillOpacity={0.15} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function TrekDetail({ trek, origin, onClose }: TrekDetailProps) {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [weatherFailed, setWeatherFailed] = useState(false);
  // Hide the hero if the image URL 404s so a dead photo never leaves a gap.
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setWeather(null);
    setWeatherFailed(false);
    setImageFailed(false);
    getWeather(trek.lat, trek.lng)
      .then((w) => active && setWeather(w))
      .catch(() => active && setWeatherFailed(true));
    return () => {
      active = false;
    };
  }, [trek.id, trek.lat, trek.lng]);

  const km = Math.round(trek.distanceKm ?? distanceFrom(origin, trek));
  // For discovery peaks with no curated difficulty, colour + label by the
  // terrain-estimated difficulty (kept honest with an "est." prefix).
  const shownDifficulty = trek.difficulty ?? trek.estimatedDifficulty;
  const color = difficultyColor(shownDifficulty);
  const difficultyText = trek.difficulty
    ? difficultyLabel(trek.difficulty)
    : trek.estimatedDifficulty
      ? `est. ${trek.estimatedDifficulty}`
      : "Unverified";
  const credit = trek.image ? splitAttribution(trek.image.attribution) : null;
  // Extra Commons photos beyond the hero (spec 15).
  const galleryThumbs = (trek.gallery ?? []).filter((g) => g.url !== trek.image?.url).slice(0, 3);

  // Download the peak (and its trail, if any) as a GPX file for phone/GPS apps.
  const downloadGpx = () => {
    const blob = new Blob([toGpx(trek)], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${trek.id}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-trail-100 dark:border-slate-700 p-4">
        <div>
          <h2
            id="trek-detail-title"
            className="font-display text-xl font-semibold text-trail-900 dark:text-slate-100"
          >
            {trek.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: color }}
            >
              {difficultyText}
            </span>
            {trek.tier === "discovery" && (
              <span className="rounded-full bg-difficulty-discovery px-2 py-0.5 text-xs font-medium text-white">
                community · unverified
              </span>
            )}
            {trek.type?.map((t) => (
              <span
                key={t}
                className="rounded-full border border-trail-200 dark:border-slate-600 bg-trail-50 dark:bg-slate-800 px-2 py-0.5 text-xs text-trail-700 dark:text-slate-300"
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
          className="rounded-md p-1 text-trail-500 dark:text-slate-400 hover:bg-trail-50 dark:hover:bg-slate-800"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {trek.image && !imageFailed && (
          <figure className="mb-3">
            <img
              src={trek.image.url}
              alt={`${trek.name}`}
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-44 w-full rounded-lg object-cover"
            />
            <figcaption className="mt-1 text-[11px] text-trail-500 dark:text-slate-400">
              {credit?.text}
              {credit?.url && (
                <>
                  {" "}
                  <a
                    href={credit.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-trail-700 dark:hover:text-slate-200"
                  >
                    source
                  </a>
                </>
              )}
            </figcaption>
          </figure>
        )}
        {galleryThumbs.length > 0 && (
          <div className="mb-3 flex gap-1.5">
            {galleryThumbs.map((g) => (
              <a
                key={g.url}
                href={splitAttribution(g.attribution).url ?? g.url}
                target="_blank"
                rel="noreferrer"
                title={splitAttribution(g.attribution).text || "Wikimedia Commons"}
                className="block h-14 w-14 flex-none overflow-hidden rounded"
              >
                <img src={g.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        )}
        {trek.highlights && (
          <p className="text-sm text-trail-700 dark:text-slate-300">{trek.highlights}</p>
        )}

        <dl className="mt-3 divide-y divide-trail-50 dark:divide-slate-700">
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

        {/* Terrain — computed from the DEM for discovery peaks (spec 11). */}
        {trek.reliefM !== undefined && (
          <div className="mt-4 rounded-lg bg-trail-50 p-3 dark:bg-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-trail-800 dark:text-slate-100">
                Terrain
              </span>
              {trek.discoveryScore !== undefined && (
                <span className="text-xs text-trail-600 dark:text-slate-400">
                  hidden-gem score {Math.round(trek.discoveryScore * 100)}/100
                </span>
              )}
            </div>
            <dl className="mt-1 divide-y divide-trail-100 dark:divide-slate-700">
              <Fact label="Local relief" value={`~${trek.reliefM} m`} />
              <Fact
                label="Mean slope"
                value={trek.meanSlopeDeg !== undefined ? `${trek.meanSlopeDeg}°` : undefined}
              />
              <Fact
                label="Prominence (approx)"
                value={
                  trek.prominenceProxyM !== undefined ? `~${trek.prominenceProxyM} m` : undefined
                }
              />
              <Fact label="Estimated difficulty" value={trek.estimatedDifficulty} />
            </dl>
            <p className="mt-1 text-[11px] text-trail-500 dark:text-slate-400">
              Computed from the Copernicus 90 m DEM; may miss small features.
            </p>
          </div>
        )}

        {/* Trail — nearest mapped OSM path + elevation profile (spec 14). */}
        {trek.trail && (
          <div className="mt-4 rounded-lg bg-trail-50 p-3 dark:bg-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-trail-800 dark:text-slate-100">Trail</span>
              <span className="text-xs text-trail-600 dark:text-slate-400">
                nearest mapped path
              </span>
            </div>
            <dl className="mt-1 divide-y divide-trail-100 dark:divide-slate-700">
              <Fact label="Trail length" value={`~${trek.trail.lengthKm} km`} />
              <Fact label="Elevation gain" value={`~${trek.trail.gainM} m`} />
            </dl>
            <ElevationProfile trail={trek.trail} />
            <p className="mt-1 text-[11px] text-trail-500 dark:text-slate-400">
              Nearest OpenStreetMap path; elevation profile from the DEM.
            </p>
          </div>
        )}

        {/* Nearby trailhead POIs (spec 15). */}
        {trek.pois && trek.pois.length > 0 && (
          <div className="mt-4 rounded-lg bg-trail-50 p-3 dark:bg-slate-800">
            <span className="text-sm font-medium text-trail-800 dark:text-slate-100">Nearby</span>
            <dl className="mt-1 divide-y divide-trail-100 dark:divide-slate-700">
              {trek.pois.map((p) => (
                <Fact
                  key={p.kind}
                  label={{ parking: "Parking", water: "Water", viewpoint: "Viewpoint" }[p.kind]}
                  value={`~${p.distM < 1000 ? `${p.distM} m` : `${(p.distM / 1000).toFixed(1)} km`}`}
                />
              ))}
            </dl>
            <p className="mt-1 text-[11px] text-trail-500 dark:text-slate-400">
              Nearest mapped facilities (OpenStreetMap).
            </p>
          </div>
        )}

        {/* Weather (optional, fills in or degrades silently) */}
        {weather && (
          <div className="mt-4 rounded-lg bg-trail-50 dark:bg-slate-800 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-trail-800 dark:text-slate-100">
                Weather now
              </span>
              <span className="text-sm text-trail-700 dark:text-slate-300">
                {Math.round(weather.tempC)}°C · {weather.summary}
              </span>
            </div>
            {weather.next3d.length > 0 && (
              <div className="mt-2 flex gap-3 text-xs text-trail-600 dark:text-slate-400">
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
          <p className="mt-4 text-xs text-trail-500 dark:text-slate-400">
            Weather unavailable right now.
          </p>
        )}
      </div>

      <div className="border-t border-trail-100 dark:border-slate-700 p-4">
        <div className="flex gap-2">
          <a
            href={googleMapsDirectionsUrl(origin, trek)}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-lg bg-trail-600 py-2 text-center text-sm font-medium text-white hover:bg-trail-700"
          >
            Directions
          </a>
          <button
            type="button"
            onClick={downloadGpx}
            className="rounded-lg border border-trail-200 px-3 py-2 text-sm font-medium text-trail-700 hover:bg-trail-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            GPX
          </button>
        </div>
        {trek.sources.length > 0 && (
          <div className="mt-3 text-xs text-trail-600 dark:text-slate-400">
            Sources:{" "}
            {trek.sources.map((url, i) => (
              <span key={url}>
                {i > 0 && ", "}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-trail-800 dark:hover:text-slate-200"
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

/**
 * Sunrise and sunset for a summit (spec 44 R6), computed with NOAA's general
 * solar position equations, never looked up. The rise and set are the moment
 * the sun's centre is 0.833° below the horizon (its radius plus standard
 * refraction), which is how almanacs define them; no correction is made for
 * the summit's height, so the times are those at the horizon a person on the
 * plain would see (a stated simplification, spec 44).
 *
 * Accuracy: within 2 minutes of the US Naval Observatory across 8–34° N on
 * both solstices and an equinox (`__fixtures__/usno-sun.json`).
 */

const RAD = Math.PI / 180;
const ZENITH = 90.833; // centre 0.833° below the horizon

export type SunTimes =
  | { kind: "normal"; rise: Date; set: Date; riseAzimuth: number; setAzimuth: number }
  | { kind: "always-up" }
  | { kind: "always-down" };

function dayOfYear(y: number, m: number, d: number): number {
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000;
}

/** NOAA: equation of time (minutes) and declination (radians) at a UTC hour. */
function solar(y: number, doy: number, hourUtc: number): { eqTime: number; decl: number } {
  const days = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const g = ((2 * Math.PI) / days) * (doy - 1 + (hourUtc - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  return { eqTime, decl };
}

/** cos of the hour angle at the rise/set zenith; outside [-1, 1] means no crossing. */
function cosHourAngle(lat: number, decl: number): number {
  const phi = lat * RAD;
  return Math.cos(ZENITH * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
}

/**
 * One crossing (rise or set) in UTC minutes after midnight. The sun's position
 * is evaluated once, at that side's rough hour: refining it at the first
 * estimate changed no result by a minute against the reference.
 */
function crossing(
  lat: number,
  lng: number,
  y: number,
  doy: number,
  sign: 1 | -1,
): { minutes: number; decl: number } | "always-up" | "always-down" {
  const { eqTime, decl } = solar(y, doy, 12 - sign * 6);
  const c = cosHourAngle(lat, decl);
  if (c > 1) return "always-down";
  if (c < -1) return "always-up";
  const ha = Math.acos(c) / RAD;
  return { minutes: 720 - 4 * (lng + sign * ha) - eqTime, decl };
}

/** Bearing (degrees from north) of the rising sun at the horizon. */
function riseAzimuth(lat: number, decl: number): number {
  const c = Math.sin(decl) / Math.cos(lat * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

/** Sunrise and sunset on a calendar date at a point (UTC instants). */
export function sunTimes(lat: number, lng: number, y: number, m: number, d: number): SunTimes {
  const doy = dayOfYear(y, m, d);
  const rise = crossing(lat, lng, y, doy, 1);
  const set = crossing(lat, lng, y, doy, -1);
  if (rise === "always-up" || set === "always-up") return { kind: "always-up" };
  if (rise === "always-down" || set === "always-down") return { kind: "always-down" };
  const at = (min: number) => new Date(Date.UTC(y, m - 1, d) + Math.round(min * 60) * 1000);
  const az = riseAzimuth(lat, rise.decl);
  return {
    kind: "normal",
    rise: at(rise.minutes),
    set: at(set.minutes),
    riseAzimuth: az,
    setAzimuth: 360 - riseAzimuth(lat, set.decl),
  };
}

/** "06:05": an instant on the IST wall clock (the dataset is all in India). */
export function toIstClock(t: Date): string {
  const ist = new Date(t.getTime() + 330 * 60_000);
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const POINTS = [
  "north",
  "north-northeast",
  "northeast",
  "east-northeast",
  "east",
  "east-southeast",
  "southeast",
  "south-southeast",
  "south",
  "south-southwest",
  "southwest",
  "west-southwest",
  "west",
  "west-northwest",
  "northwest",
  "north-northwest",
];

/** The nearest of the sixteen compass points to a bearing. */
export function compassPoint(bearing: number): string {
  const i = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return POINTS[i];
}

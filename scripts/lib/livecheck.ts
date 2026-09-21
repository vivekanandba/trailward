/**
 * Live upstream contract probes (spec 42 §A).
 *
 * Each probe names a source, the URL to hit, and a PURE check over the body
 * we got back. The purity is the point: the check runs offline in unit tests
 * against a recorded body and against the exact drift it exists to catch, so
 * the scheduled job is not the only thing that has ever executed it.
 *
 * Shape only, never values. A summit's elevation changing is not drift, and a
 * probe asserting it would fail for the wrong reason forever.
 */

export type ProbeVerdict =
  | { state: "ok"; detail?: string }
  /** The response arrived and is not what we depend on. This is drift. */
  | { state: "drift"; detail: string }
  /** We could not tell — a timeout, a transport error. NOT drift (CON-DATA-002). */
  | { state: "unverified"; detail: string };

export interface Probe {
  name: string;
  url: string;
  /** POST body, for SPARQL-style endpoints. */
  body?: string;
  headers?: Record<string, string>;
  /** True when this endpoint answers with bytes rather than text. */
  binary?: boolean;
  check: (body: string | Buffer) => ProbeVerdict;
}

const ok = (detail?: string): ProbeVerdict => ({ state: "ok", detail });
const drift = (detail: string): ProbeVerdict => ({ state: "drift", detail });

/** Parse JSON, reporting a non-JSON body as drift rather than throwing. */
function json(body: string | Buffer): { value: unknown } | ProbeVerdict {
  try {
    return { value: JSON.parse(body.toString()) };
  } catch {
    // An HTML error page served with a 200 lands here. That IS drift: the
    // contract says JSON.
    return drift(`expected JSON, got ${body.toString().slice(0, 80)}…`);
  }
}

const isVerdict = (v: unknown): v is ProbeVerdict =>
  typeof v === "object" && v !== null && "state" in v;

/** An array lives at `path` (dot-separated) in the parsed body. */
export function expectArrayAt(body: string | Buffer, path: string): ProbeVerdict {
  const parsed = json(body);
  if (isVerdict(parsed)) return parsed;
  let node: unknown = parsed.value;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null || !(key in node)) {
      return drift(`no '${path}' in the response`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  if (!Array.isArray(node)) return drift(`'${path}' is not an array`);
  return ok(`${node.length} row(s)`);
}

/**
 * Overpass reports server-side failure as HTTP 200 with a `remark`. Reading
 * that as "no peaks here" produced an empty bake that looked like a correct
 * answer about the terrain — twice. So the absence of `remark` is part of the
 * contract, not a nicety.
 */
export function checkOverpass(body: string | Buffer): ProbeVerdict {
  const parsed = json(body);
  if (isVerdict(parsed)) return parsed;
  const value = parsed.value as { elements?: unknown; remark?: unknown };
  if (typeof value?.remark === "string") {
    return drift(`Overpass answered 200 with a remark: ${value.remark.slice(0, 120)}`);
  }
  if (!Array.isArray(value?.elements)) return drift("no 'elements' array in the response");
  return ok(`${value.elements.length} element(s)`);
}

/** Open-Meteo's archive: the daily rainfall series we derive seasons from. */
export function checkRainfall(body: string | Buffer): ProbeVerdict {
  const parsed = json(body);
  if (isVerdict(parsed)) return parsed;
  const daily = (parsed.value as { daily?: { precipitation_sum?: unknown } })?.daily;
  const series = daily?.precipitation_sum;
  if (!Array.isArray(series)) return drift("no 'daily.precipitation_sum' array");
  if (!series.some((v) => typeof v === "number")) {
    return drift("'daily.precipitation_sum' holds no numbers");
  }
  return ok(`${series.length} day(s)`);
}

/** Elevation, where the LENGTH is the contract: a short answer misaligns points. */
export function checkElevations(expected: number) {
  return (body: string | Buffer): ProbeVerdict => {
    const parsed = json(body);
    if (isVerdict(parsed)) return parsed;
    const arr = (parsed.value as { elevation?: unknown })?.elevation;
    if (!Array.isArray(arr)) return drift("no 'elevation' array");
    if (arr.length !== expected) {
      return drift(`asked for ${expected} elevations, got ${arr.length}`);
    }
    return ok(`${arr.length} point(s)`);
  };
}

/** OpenTopoData — the failover. Untested, a failover is fiction. */
export function checkTopoData(body: string | Buffer): ProbeVerdict {
  const parsed = json(body);
  if (isVerdict(parsed)) return parsed;
  const results = (parsed.value as { results?: unknown })?.results;
  if (!Array.isArray(results)) return drift("no 'results' array");
  if (!results.some((r) => typeof (r as { elevation?: unknown })?.elevation === "number")) {
    return drift("no numeric 'results[].elevation'");
  }
  return ok(`${results.length} result(s)`);
}

/** Nominatim reverse geocode: an address object we read a town out of. */
export function checkAddress(body: string | Buffer): ProbeVerdict {
  const parsed = json(body);
  if (isVerdict(parsed)) return parsed;
  const address = (parsed.value as { address?: unknown })?.address;
  if (typeof address !== "object" || address === null || Array.isArray(address)) {
    return drift("no 'address' object");
  }
  return ok(`${Object.keys(address).length} field(s)`);
}

/** A file's leading bytes match a magic number. */
export function checkMagic(name: string, magic: number[]) {
  return (body: string | Buffer): ProbeVerdict => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (buf.length < magic.length) return drift(`truncated: ${buf.length} byte(s)`);
    const head = [...buf.subarray(0, magic.length)];
    if (!head.every((b, i) => b === magic[i])) {
      return drift(`not a ${name}: leading bytes ${head.map((b) => b.toString(16)).join(" ")}`);
    }
    return ok(`${buf.length} byte(s)`);
  };
}

export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
// TIFF is little- or big-endian; a COG is a TIFF.
export const TIFF_MAGIC_LE = [0x49, 0x49, 0x2a, 0x00];

export function checkTiff(body: string | Buffer): ProbeVerdict {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (buf.length < 4) return drift(`truncated: ${buf.length} byte(s)`);
  const head = [...buf.subarray(0, 4)];
  const le = head.every((b, i) => b === TIFF_MAGIC_LE[i]);
  const be = head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a;
  if (!le && !be) {
    return drift(`not a TIFF: leading bytes ${head.map((b) => b.toString(16)).join(" ")}`);
  }
  return ok(`${buf.length} byte(s)`);
}

/** A point in the Nandi Hills — inside every source's coverage. */
const LAT = 13.37;
const LNG = 77.68;

export const PROBES: Probe[] = [
  {
    name: "Overpass",
    url: "https://overpass-api.de/api/interpreter",
    body: `[out:json][timeout:25];node(around:1000,${LAT},${LNG})[natural=peak];out 1;`,
    check: checkOverpass,
  },
  {
    name: "Open-Meteo archive (rainfall)",
    url:
      `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LNG}` +
      `&start_date=2024-01-01&end_date=2024-01-07&daily=precipitation_sum&timezone=UTC`,
    check: checkRainfall,
  },
  {
    name: "Open-Meteo elevation",
    url: `https://api.open-meteo.com/v1/elevation?latitude=${LAT},${LAT}&longitude=${LNG},${LNG}`,
    check: checkElevations(2),
  },
  {
    name: "OpenTopoData (elevation failover)",
    url: `https://api.opentopodata.org/v1/aster30m?locations=${LAT},${LNG}`,
    check: checkTopoData,
  },
  {
    name: "Nominatim reverse",
    url: `https://nominatim.openstreetmap.org/reverse?lat=${LAT}&lon=${LNG}&format=jsonv2&zoom=13&addressdetails=1`,
    check: checkAddress,
  },
  {
    name: "Wikipedia GeoSearch",
    url:
      `https://en.wikipedia.org/w/api.php?action=query&list=geosearch` +
      `&gscoord=${encodeURIComponent(`${LAT}|${LNG}`)}&gsradius=1000&gslimit=5&format=json`,
    check: (b) => expectArrayAt(b, "query.geosearch"),
  },
  {
    name: "Wikimedia Commons geosearch",
    url:
      `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gsnamespace=6` +
      `&gscoord=${encodeURIComponent(`${LAT}|${LNG}`)}&gsradius=3000&gslimit=5&format=json`,
    check: (b) => expectArrayAt(b, "query.geosearch"),
  },
  {
    name: "Wikidata SPARQL",
    url: `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(
      "SELECT ?item WHERE { ?item wdt:P31 wd:Q8502 } LIMIT 1",
    )}`,
    headers: { accept: "application/sparql-results+json" },
    check: (b) => expectArrayAt(b, "results.bindings"),
  },
  {
    name: "Terrarium DEM tile",
    url: "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/2957/1847.png",
    binary: true,
    check: checkMagic("PNG", PNG_MAGIC),
  },
  {
    name: "ESA WorldCover COG",
    url:
      "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/" +
      "ESA_WorldCover_10m_2021_v200_N12E075_Map.tif",
    binary: true,
    check: checkTiff,
  },
];

export interface ProbeResult {
  name: string;
  verdict: ProbeVerdict;
}

/** Group results into the report the scheduled job prints and files. */
export function summariseProbes(results: ProbeResult[]): {
  drifted: ProbeResult[];
  unverified: ProbeResult[];
  text: string;
} {
  const drifted = results.filter((r) => r.verdict.state === "drift");
  const unverified = results.filter((r) => r.verdict.state === "unverified");
  const icon = { ok: "ok  ", drift: "DRIFT", unverified: "?   " } as const;
  const lines = results.map((r) => {
    const d = r.verdict.detail ? ` — ${r.verdict.detail}` : "";
    return `${icon[r.verdict.state]}  ${r.name}${d}`;
  });
  const counts =
    `${results.length - drifted.length - unverified.length} ok · ` +
    `${drifted.length} drifted · ${unverified.length} unverified`;
  return { drifted, unverified, text: [counts, "", ...lines].join("\n") };
}

/** The issue body filed on drift — stable title so it updates, not duplicates. */
export const DRIFT_ISSUE_TITLE = "Upstream API drift detected";

export function driftIssueBody(results: ProbeResult[], runUrl?: string): string {
  const { text, drifted } = summariseProbes(results);
  return [
    `${drifted.length} source(s) no longer return the shape this project depends on.`,
    "",
    "This is **advisory** — it does not block a build. But a bake against a drifted",
    "source can produce nothing and look like a correct answer about the terrain,",
    "which has happened here twice, so it is worth looking at before the next refresh.",
    "",
    "```",
    text,
    "```",
    "",
    runUrl ? `[Workflow run](${runUrl})` : "",
    "",
    "_Filed automatically by the weekly live contract check (spec 42). This issue is",
    "updated in place rather than re-filed, so one persistent outage stays one thread._",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

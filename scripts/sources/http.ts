/**
 * Build-time HTTP helpers (spec 02). Every outbound request goes through here so
 * we can enforce one policy: a descriptive User-Agent, a host allowlist, gentle
 * per-host rate limiting, and bounded retries with backoff. Tests cover the
 * pure allowlist; the fetch wrappers are exercised by the live pipeline only.
 */
import { request } from "undici";

const USER_AGENT =
  "TrailwardBot/0.1 (+https://github.com/vivekanandba/trailward; trek data pipeline)";

// Allowlist: only these hosts may be fetched. AllTrails and Google Maps/Places
// are deliberately absent — scraping them violates their ToS (spec 02).
export const ALLOWED_HOSTS = new Set<string>([
  "overpass-api.de",
  "overpass.kumi.systems", // Overpass mirror — failover when the main endpoint 429/504s
  "api.open-meteo.com",
  "api.opentopodata.org", // elevation failover when Open-Meteo throttles (spec 11)
  "router.project-osrm.org",
  "en.wikipedia.org",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "nominatim.openstreetmap.org", // reverse geocode: nearest town for a discovery peak
]);

export function isAllowedHost(url: string): boolean {
  try {
    return ALLOWED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Throw a clear error for a disallowed host so a bad source URL fails loudly. */
export function assertAllowedHost(url: string): void {
  if (!isAllowedHost(url)) {
    throw new Error(`[http] host not allowed (off the allowlist): ${url}`);
  }
}

// Track the last request time per host to keep to <=1 req/s/host.
const lastHit = new Map<string, number>();
const MIN_GAP_MS = 1000;

// Per-attempt network timeout so a stalled endpoint fails fast instead of
// hanging on undici's multi-minute defaults.
const REQUEST_TIMEOUT_MS = 15_000;

/** A failure that must not be retried (e.g. a 4xx that won't change on retry). */
class NonRetryableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(host: string): Promise<void> {
  const now = Date.now();
  const last = lastHit.get(host) ?? 0;
  const wait = last + MIN_GAP_MS - now;
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

interface GetOptions {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  retries?: number;
  /** Per-attempt network timeout override (ms). Defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Fetch a URL's text, enforcing the allowlist, rate limit, and retries. */
export async function fetchText(url: string, opts: GetOptions = {}): Promise<string> {
  assertAllowedHost(url);
  const host = new URL(url).hostname;
  const retries = opts.retries ?? 2;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    try {
      const timeout = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
      const res = await request(url, {
        method: opts.method ?? "GET",
        body: opts.body,
        headers: { "user-agent": USER_AGENT, ...opts.headers },
        // Bound each attempt so one stalled host can't hang the whole build.
        headersTimeout: timeout,
        bodyTimeout: timeout,
      });
      // request() does not follow redirects, so a 3xx body is just a stub —
      // returning it would feed garbage to JSON.parse. 3xx and 4xx won't change
      // on retry (fail fast); only 5xx falls through to the retry path.
      if (res.statusCode >= 300 && res.statusCode < 500) {
        throw new NonRetryableError(`HTTP ${res.statusCode} for ${url}`);
      }
      if (res.statusCode >= 500) throw new Error(`HTTP ${res.statusCode} for ${url}`);
      return await res.body.text();
    } catch (err) {
      lastErr = err;
      if (err instanceof NonRetryableError) break;
      if (attempt < retries) await sleep(500 * (attempt + 1)); // linear backoff
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`fetch failed: ${url}`);
}

/** Fetch and JSON-parse a URL. */
export async function fetchJson<T = unknown>(url: string, opts: GetOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}

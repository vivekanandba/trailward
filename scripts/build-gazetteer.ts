/**
 * build-gazetteer — occasional build tool (NOT the weekly cron). Downloads the
 * OCR'd plain text of public-domain gazetteer volumes from archive.org across
 * SEVERAL series (Imperial Gazetteer 1908, Rice's Mysore Gazetteer 1897, the
 * Bombay Presidency series, the Madras District Gazetteers), extracts
 * coordinate-bearing summit entries, matches them to our treks by name AND
 * coordinate AND elevation, and bakes a short attributed excerpt onto the
 * matches as `historicalNote` — each note credited to the series it came from.
 *
 * Text is cached under scripts/.cache/gazetteer (with a manifest recording each
 * volume's series), so re-runs need no network.
 *   npm run build:gazetteer
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import { parseGazetteerEntries, matchEntries, type GazetteerEntry } from "./sources/gazetteer";

const here = dirname(fileURLToPath(import.meta.url));
const treksFile = resolve(here, "../src/data/treks.json");
const cacheDir = resolve(here, ".cache/gazetteer");
const manifestFile = resolve(cacheDir, "manifest.json");

/** A public-domain gazetteer series we mine. Years are the series' era. */
export interface Series {
  key: string;
  name: string;
  year: number;
  query: string; // archive.org advancedsearch query
  maxVolumes: number;
}

export const SERIES: Series[] = [
  {
    key: "imperial",
    name: "Imperial Gazetteer of India",
    year: 1908,
    query: 'title:("Imperial Gazetteer of India") AND mediatype:texts AND format:"DjVuTXT"',
    maxVolumes: 24,
  },
  {
    key: "mysore",
    name: "Mysore: A Gazetteer (B. L. Rice)",
    year: 1897,
    query: 'title:(Mysore) AND title:(gazetteer) AND mediatype:texts AND format:"DjVuTXT"',
    maxVolumes: 8,
  },
  // Bombay Presidency and Madras District Gazetteers were evaluated and DROPPED:
  // they are running prose organised by chapter, with almost no per-place
  // coordinates (the whole Thana "Places of Interest" volume has 15 "latitude"
  // mentions), so the coordinate-verified matcher — correctly — finds nothing.
  // A name-only match would risk exactly the mislabelling this design exists to
  // prevent. Revisit only with a series that uses dictionary-style entries.
];

const SERIES_NAMES = new Set(SERIES.map((s) => s.name));

/** Return the trek without one optional key (no leftover `undefined` in JSON). */
function omit(t: Trek, key: keyof Trek): Trek {
  const copy = { ...t };
  delete copy[key];
  return copy;
}

/**
 * Archive.org's `title` is a multi-valued Solr field: most records return a
 * string, but some return an array of strings. Normalise before use — calling
 * .toLowerCase() on the array form throws and kills discovery.
 */
function titleOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string").join(" ");
  return "";
}

/** Discover candidate volume identifiers, most-relevant first. */
export function pickVolumes(docs: { identifier?: string; title?: unknown }[], max = 24): string[] {
  // Prefer volumes whose title names an alphabetical range or a southern
  // province — those hold the place entries we can match. "Statistical
  // appendix" volumes are tables, not prose, so they rank last.
  const score = (title: string): number => {
    const t = title.toLowerCase();
    let s = 0;
    if (/\bvol/.test(t)) s += 1;
    if (/madras|mysore|coorg|hyderabad|bombay|poona|satara|kolaba|nasik|salem|coimbatore/.test(t))
      s += 3;
    if (/\bto\b/.test(t)) s += 2; // "Pardi To Pusad" — an alphabetical span
    if (/provincial series/.test(t)) s += 1;
    if (/statistical appendix/.test(t)) s -= 4;
    if (/1885|1886/.test(t)) s -= 1; // older edition, thinner entries
    return s;
  };
  return (
    [...docs]
      .map((d) => ({ identifier: d.identifier, title: titleOf(d.title) }))
      .filter((d): d is { identifier: string; title: string } => Boolean(d.identifier && d.title))
      // Deterministic: archive.org returns equal-scored hits in arbitrary order,
      // which silently changed which volumes we downloaded (and so how many treks
      // matched) between runs. Tie-break on identifier so the set is stable.
      .sort((a, b) => score(b.title) - score(a.title) || a.identifier.localeCompare(b.identifier))
      .map((d) => d.identifier)
      .slice(0, max)
  );
}

function discoverVolumes(series: Series): string[] {
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(series.query)}` +
    `&fl[]=identifier&fl[]=title&rows=200&output=json`;
  try {
    const json = JSON.parse(
      execSync(`curl -sSL -m 60 -A "TrailwardBot/0.1 (trek data)" "${url}"`, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
    ) as { response?: { docs?: { identifier?: string; title?: unknown }[] } };
    return pickVolumes(json.response?.docs ?? [], series.maxVolumes);
  } catch (err) {
    console.warn(`[gazetteer] ${series.key} discovery failed: ${(err as Error).message}`);
    return [];
  }
}

// volumeId → series key, persisted so cached volumes keep their attribution
// across runs (legacy cache entries predate the manifest → imperial).
type Manifest = Record<string, string>;

function loadManifest(): Manifest {
  let manifest: Manifest = {};
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
  } catch {
    manifest = {};
  }
  // Cached volumes that predate the manifest were all fetched by the original
  // Imperial-only build — seed them so they keep contributing (and keep their
  // correct attribution) instead of being orphaned.
  try {
    for (const f of readdirSync(cacheDir)) {
      if (!f.endsWith(".txt")) continue;
      const id = f.replace(/\.txt$/, "");
      manifest[id] = manifest[id] ?? "imperial";
    }
  } catch {
    // cache dir may not exist yet
  }
  return manifest;
}

interface ArchiveMeta {
  server?: string;
  dir?: string;
  files?: { name: string }[];
}

/** Fetch a volume's OCR text (cached). Returns null when unavailable. */
async function volumeText(id: string): Promise<string | null> {
  const cached = resolve(cacheDir, `${id}.txt`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");

  let meta: ArchiveMeta;
  try {
    meta = JSON.parse(
      execSync(
        `curl -sSL -m 60 -A "TrailwardBot/0.1 (trek data)" "https://archive.org/metadata/${id}"`,
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      ),
    ) as ArchiveMeta;
  } catch {
    return null;
  }
  const txt = meta.files?.find((f) => /_djvu\.txt$/.test(f.name))?.name;
  if (!txt || !meta.server || !meta.dir) return null;

  const url = `https://${meta.server}${meta.dir}/${encodeURIComponent(txt)}`;
  try {
    const body = execSync(`curl -sSL -m 180 -A "TrailwardBot/0.1 (trek data)" "${url}"`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (body.length < 10_000) return null; // truncated / error page
    writeFileSync(cached, body, "utf8");
    return body;
  } catch {
    return null;
  }
}

type SourcedEntry = GazetteerEntry & { source: string; year: number };

async function main(): Promise<void> {
  mkdirSync(cacheDir, { recursive: true });
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const manifest = loadManifest();

  // Per series: every volume we've ever cached for it, plus newly discovered
  // ones — parsing is free once the text is local, so matches accumulate
  // instead of fluctuating with whatever the search returned this time.
  const entries: SourcedEntry[] = [];
  for (const series of SERIES) {
    const cachedIds = Object.entries(manifest)
      .filter(([, key]) => key === series.key)
      .map(([id]) => id);
    const ids = [...new Set([...cachedIds, ...discoverVolumes(series)])];
    let found = 0;
    let ok = 0;
    for (const id of ids) {
      const text = await volumeText(id);
      if (!text) continue;
      manifest[id] = manifest[id] ?? series.key;
      // A volume can be discovered by two queries (Imperial "provincial series
      // Mysore" matches both); its entries count once, under its first series.
      if (manifest[id] !== series.key) continue;
      const parsed = parseGazetteerEntries(text);
      entries.push(...parsed.map((e) => ({ ...e, source: series.name, year: series.year })));
      found += parsed.length;
      ok++;
    }
    console.log(`[gazetteer] ${series.key}: ${ok}/${ids.length} volumes, ${found} entries`);
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  if (entries.length === 0) throw new Error("no gazetteer entries parsed; refusing to write");

  const matches = matchEntries(entries, treks);
  console.log(
    `[gazetteer] ${entries.length} entries → ${matches.size} coordinate-verified trek matches`,
  );

  let baked = 0;
  const next = treks.map((t) => {
    const e = matches.get(t.id);
    if (!e) {
      // Drop a stale note from any of our series if this trek no longer matches.
      if (t.historicalNote && SERIES_NAMES.has(t.historicalNote.source)) {
        return omit(t, "historicalNote");
      }
      return t;
    }
    baked++;
    return {
      ...t,
      historicalNote: {
        text: e.text,
        source: e.source,
        year: e.year,
        url: `https://archive.org/search?query=${encodeURIComponent(e.source)}`,
      },
    };
  });

  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[gazetteer] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  console.log(`[gazetteer] baked historicalNote onto ${baked} treks.`);
  for (const t of ds.treks.filter((x) => x.historicalNote).slice(0, 14)) {
    console.log(
      `  · ${t.name} [${t.historicalNote!.year}]: ${t.historicalNote!.text.slice(0, 80)}…`,
    );
  }
}

// Only run when invoked as a CLI — importing this module (tests) must not
// kick off a build, mirroring the guard in discover-precompute.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

/**
 * build-gazetteer — occasional build tool (NOT the weekly cron). Downloads the
 * OCR'd plain text of public-domain Imperial Gazetteer of India (1908) volumes
 * from archive.org, extracts coordinate-bearing summit entries, matches them to
 * our treks by name AND coordinate, and bakes a short attributed excerpt onto
 * the matches as `historicalNote`.
 *
 * Text is cached under scripts/.cache/gazetteer so re-runs need no network.
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

const SOURCE_NAME = "Imperial Gazetteer of India";
const SOURCE_YEAR = 1908;

/** Return the trek without one optional key (no leftover `undefined` in JSON). */
function omit(t: Trek, key: keyof Trek): Trek {
  const copy = { ...t };
  delete copy[key];
  return copy;
}

// Archive.org identifiers for these scans are inconsistent (dli.*, in.ernet.*,
// rbanms.*, …), so they are DISCOVERED via the search API rather than guessed.
// Bounded so a hand-run stays reasonable; the alphabetical place-name volumes
// and the southern provincial series are what carry hill entries.
const MAX_VOLUMES = 24;
const DISCOVER_QUERY =
  'title:("Imperial Gazetteer of India") AND mediatype:texts AND format:"DjVuTXT"';

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
export function pickVolumes(
  docs: { identifier?: string; title?: unknown }[],
  max = MAX_VOLUMES,
): string[] {
  // Prefer volumes whose title names an alphabetical range or a southern
  // province — those hold the place entries we can match.
  const score = (title: string): number => {
    const t = title.toLowerCase();
    let s = 0;
    if (/\bvol/.test(t)) s += 1;
    if (/madras|mysore|coorg|hyderabad|bombay/.test(t)) s += 3;
    if (/\bto\b/.test(t)) s += 2; // "Pardi To Pusad" — an alphabetical span
    if (/provincial series/.test(t)) s += 1;
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

function discoverVolumes(): string[] {
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(DISCOVER_QUERY)}` +
    `&fl[]=identifier&fl[]=title&rows=120&output=json`;
  try {
    const json = JSON.parse(
      execSync(`curl -sSL -m 60 -A "TrailwardBot/0.1 (trek data)" "${url}"`, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
    ) as { response?: { docs?: { identifier?: string; title?: unknown }[] } };
    return pickVolumes(json.response?.docs ?? []);
  } catch (err) {
    console.warn(`[gazetteer] volume discovery failed: ${(err as Error).message}`);
    return [];
  }
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
        {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        },
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

async function main(): Promise<void> {
  mkdirSync(cacheDir, { recursive: true });
  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];

  // Every volume we've ever cached, plus newly discovered ones: parsing is free
  // once the text is local, and it means matches accumulate instead of
  // fluctuating with whatever the search happened to return this time.
  const cached = readdirSync(cacheDir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(/\.txt$/, ""));
  const volumes = [...new Set([...cached, ...discoverVolumes()])];
  if (volumes.length === 0) throw new Error("no gazetteer volumes discovered");
  console.log(`[gazetteer] ${volumes.length} volumes (${cached.length} cached)`);

  const entries: GazetteerEntry[] = [];
  for (const id of volumes) {
    const text = await volumeText(id);
    if (!text) {
      console.warn(`[gazetteer] ${id}: unavailable, skipped`);
      continue;
    }
    const found = parseGazetteerEntries(text);
    entries.push(...found);
    console.log(`[gazetteer] ${id}: ${found.length} coordinate-bearing summit entries`);
  }
  if (entries.length === 0) throw new Error("no gazetteer entries parsed; refusing to write");

  const matches = matchEntries(entries, treks);
  console.log(
    `[gazetteer] ${entries.length} entries → ${matches.size} coordinate-verified trek matches`,
  );

  let baked = 0;
  const next = treks.map((t) => {
    const e = matches.get(t.id);
    if (!e) {
      // Drop a stale note if this trek no longer matches (keeps re-runs honest).
      if (t.historicalNote?.source === SOURCE_NAME) return omit(t, "historicalNote");
      return t;
    }
    baked++;
    return {
      ...t,
      historicalNote: {
        text: e.text,
        source: SOURCE_NAME,
        year: SOURCE_YEAR,
        url: `https://archive.org/search?query=${encodeURIComponent(SOURCE_NAME)}`,
      },
    };
  });

  const ds = validateDataset(next);
  if (!ds.ok) throw new Error(`[gazetteer] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  console.log(`[gazetteer] baked historicalNote onto ${baked} treks.`);
  for (const t of ds.treks.filter((x) => x.historicalNote).slice(0, 8)) {
    console.log(`  · ${t.name}: ${t.historicalNote!.text.slice(0, 90)}…`);
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

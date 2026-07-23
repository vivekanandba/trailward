/**
 * build-geonames — occasional build tool (NOT the weekly cron). Downloads the
 * GeoNames India dump (CC-BY 4.0), filters to named summits (peaks/hills/
 * mountains/rocks) within reach of the preset regions, and writes a compact,
 * committed subset the discovery pipeline reads. The cron never re-downloads —
 * re-run this by hand to refresh:  npm run build:geonames
 */
import { execSync } from "node:child_process";
import { createReadStream, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { distanceFrom } from "../../src/lib/distance";
import { PRESET_ORIGINS } from "../../src/lib/cities";

const SUMMIT_CODES = new Set(["PK", "PKS", "HLL", "HLLS", "MT", "MTS", "RK", "RKS"]);
const REACH_KM = 520; // a little over Bengaluru's 500 km, so nothing near an edge is lost

export interface GeonamesSummit {
  id: string; // geonameid
  name: string;
  lat: number;
  lng: number;
  elevationM?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "india-summits.json");

function inReach(lat: number, lng: number): boolean {
  return PRESET_ORIGINS.some((o) => distanceFrom(o, { lat, lng }) <= REACH_KM);
}

async function main(): Promise<void> {
  const tmp = resolve(here, ".cache");
  mkdirSync(tmp, { recursive: true });
  const txt = resolve(tmp, "IN.txt");
  if (!existsSync(txt)) {
    console.log("[geonames] downloading IN.zip …");
    execSync(
      `curl -sSL -A "TrailwardBot/0.1 (trek data)" -o "${tmp}/IN.zip" https://download.geonames.org/export/dump/IN.zip`,
    );
    execSync(`unzip -o "${tmp}/IN.zip" IN.txt -d "${tmp}"`, { stdio: "ignore" });
  }

  const summits: GeonamesSummit[] = [];
  const rl = createInterface({ input: createReadStream(txt, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split("\t");
    if (c.length < 17 || c[6] !== "T" || !SUMMIT_CODES.has(c[7])) continue;
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (Number.isNaN(lat) || Number.isNaN(lng) || !inReach(lat, lng)) continue;
    const elevRaw = Number(c[15]) || Number(c[16]); // elevation, else SRTM dem
    const elevationM =
      Number.isFinite(elevRaw) && elevRaw > 0 && elevRaw <= 9000 ? Math.round(elevRaw) : undefined;
    summits.push({ id: c[0], name: c[1], lat, lng, elevationM });
  }

  writeFileSync(OUT, JSON.stringify(summits) + "\n", "utf8");
  console.log(`[geonames] wrote ${summits.length} summits (CC-BY GeoNames) → ${OUT}`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});

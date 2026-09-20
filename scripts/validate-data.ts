/**
 * validate-data — fails CI if src/data/treks.json is missing or malformed.
 * The deploy job depends on this passing (alongside tests).
 *
 * Enforces the full data-model contract (specs/01-data-model.md) via the same
 * validateDataset the app and pipeline use: every record valid + unique ids.
 * The work lives behind an I/O seam (spec 40) so the failure paths — missing
 * file, unparseable JSON, an invalid record — are asserted, not assumed.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { validateDataset } from "../src/lib/trek";
import { nodeIO, type BuildIO } from "./lib/buildIO";

const here = dirname(fileURLToPath(import.meta.url));

/** Returns the record count. Throws with a human reason on any failure. */
export function runValidateData(io: BuildIO, dataPath: string): number {
  if (!io.exists(dataPath)) {
    throw new Error(`${dataPath} is missing — the app has no dataset to serve`);
  }
  // Read and parse are separated on purpose. With the read inside the try, an
  // EISDIR or EACCES was reported as "is not valid JSON" — a check that
  // misdiagnoses is worse than no check (CON-VER-005), because it sends whoever
  // reads the CI log after a problem that does not exist.
  let raw: string;
  try {
    raw = io.readFile(dataPath);
  } catch (err) {
    throw new Error(`${dataPath} could not be read: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${dataPath} is not valid JSON`);
  }
  const result = validateDataset(parsed);
  if (!result.ok) throw new Error(result.error);
  io.log(`[validate-data] ok — ${result.treks.length} trek record(s)`);
  return result.treks.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runValidateData(nodeIO, resolve(here, "../src/data/treks.json"));
  } catch (err) {
    console.error(`[validate-data] FAILED: ${(err as Error).message}`);
    process.exit(1);
  }
}

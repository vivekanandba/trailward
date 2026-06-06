/**
 * validate-data — fails CI if src/data/treks.json is missing or malformed.
 * The deploy job depends on this passing (alongside tests).
 *
 * Enforces the full data-model contract (specs/01-data-model.md) via the same
 * validateDataset the app and pipeline use: every record valid + unique ids.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateDataset } from "../src/lib/trek";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, "../src/data/treks.json");

try {
  const raw = readFileSync(dataPath, "utf8");
  const result = validateDataset(JSON.parse(raw));
  if (!result.ok) {
    throw new Error(result.error);
  }
  console.log(`[validate-data] ok — ${result.treks.length} trek record(s)`);
} catch (err) {
  console.error(`[validate-data] FAILED: ${(err as Error).message}`);
  process.exit(1);
}

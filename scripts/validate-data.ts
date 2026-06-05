/**
 * validate-data — fails CI if src/data/treks.json is missing or malformed.
 * The deploy job depends on this passing (alongside tests).
 *
 * Phase A: minimal shape check. Full schema/invariant validation arrives in
 * Phase B with the data model (specs/01-data-model.md).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, "../src/data/treks.json");

try {
  const raw = readFileSync(dataPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("treks.json must be a JSON array");
  }
  console.log(`[validate-data] ok — ${parsed.length} trek record(s)`);
} catch (err) {
  console.error(`[validate-data] FAILED: ${(err as Error).message}`);
  process.exit(1);
}

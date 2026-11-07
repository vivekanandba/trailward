/**
 * Test-only: `memoryIO` seeded with the slug registry `npm run build:slugs`
 * would bootstrap for the fixture's treks.json (spec 35), so fixtures written
 * before the registry existed keep testing what they were written for. A test
 * that is about the registry passes its own and this leaves it alone.
 */
import { memoryIO } from "./buildIO";
import { SLUGS_FILE, registryFor } from "./slugs";
import type { Trek } from "../../src/lib/trek";

export function memoryIOWithSlugs(seed: Record<string, string> = {}): ReturnType<typeof memoryIO> {
  const treks = Object.keys(seed).find((k) => k.endsWith("/src/data/treks.json"));
  if (!treks) return memoryIO(seed);
  const slugs = treks.replace("src/data/treks.json", SLUGS_FILE);
  if (slugs in seed) return memoryIO(seed);
  const registry = registryFor(JSON.parse(seed[treks]) as Trek[]);
  return memoryIO({ ...seed, [slugs]: JSON.stringify(registry) });
}

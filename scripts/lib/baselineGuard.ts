/**
 * Baselines come only from the "Update visual baselines" workflow, which
 * renders on the pinned CI image (spec 42 §E). Any other run that writes a
 * screenshot baseline writes this machine's font rendering into it.
 *
 * This is playwright.config.ts's globalSetup, so it reads the update mode
 * Playwright itself resolved from every spelling of `-u` / `--update-snapshots`
 * and the config, instead of re-parsing the command line: two rounds of
 * hand-parsing each let a spelling through or refused an ordinary run.
 */
import type { FullConfig } from "@playwright/test";

/** Set only on the baseline workflow's two update steps. */
export const BASELINES_ENV = "TRAILWARD_BASELINES";

/** Why a run with this update mode must not start, or undefined. */
export function baselineRefusal(
  mode: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (mode === "none" || env[BASELINES_ENV] === "1") return undefined;
  return (
    `Refusing --update-snapshots=${mode}: baselines come only from the "Update visual ` +
    `baselines" workflow, on the pinned CI image (spec 42 §E). A failing run leaves its ` +
    `actual and diff images in test-results/.`
  );
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const refusal = baselineRefusal(config.updateSnapshots, process.env);
  if (refusal) throw new Error(refusal);
}

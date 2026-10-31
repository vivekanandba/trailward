import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import globalSetup, { BASELINES_ENV, baselineRefusal } from "./baselineGuard";

describe("baselineRefusal (spec 42 §E)", () => {
  it("refuses every mode that writes, unless the baseline workflow asked", () => {
    for (const mode of ["all", "changed", "missing"]) {
      expect(baselineRefusal(mode, {}), mode).toMatch(/^Refusing --update-snapshots=/);
      expect(baselineRefusal(mode, { [BASELINES_ENV]: "1" }), mode).toBeUndefined();
    }
    expect(baselineRefusal("none", {})).toBeUndefined();
  });

  it("globalSetup throws on the resolved mode it is given", async () => {
    const saved = process.env[BASELINES_ENV];
    delete process.env[BASELINES_ENV];
    try {
      const cfg = (mode: string) => ({ updateSnapshots: mode }) as unknown as FullConfig;
      await expect(globalSetup(cfg("all"))).rejects.toThrow(/Refusing --update-snapshots=all/);
      await expect(globalSetup(cfg("none"))).resolves.toBeUndefined();
    } finally {
      if (saved !== undefined) process.env[BASELINES_ENV] = saved;
    }
  });
});

// The real CLI against a throwaway project that uses this guard as its
// globalSetup: every spelling is resolved by Playwright, not by us, and an
// ordinary run whose grep happens to contain a "u" is not refused.
describe("the guard on Playwright's own resolution of the command line", () => {
  const root = resolve(__dirname, "../..");
  const cli = resolve(root, "node_modules/@playwright/test/cli.js");
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "baseline-guard-"));
    writeFileSync(
      join(dir, "pw.config.ts"),
      `export default { testDir: ".", updateSnapshots: "none", reporter: "line",
        globalSetup: ${JSON.stringify(resolve(__dirname, "baselineGuard.ts"))} };\n`,
    );
    writeFileSync(
      join(dir, "a.spec.ts"),
      `import { test } from "@playwright/test";\ntest("route", () => {});\n`,
    );
  });

  /** Exit status and everything printed: Playwright reports a setup error on stdout. */
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [cli, "test", "-c", "pw.config.ts", ...args], {
      cwd: dir,
      env: {
        ...process.env,
        CI: "",
        [BASELINES_ENV]: "",
        NODE_PATH: join(root, "node_modules"),
        ...env,
      },
      encoding: "utf8",
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it.each([["-u"], ["-uall"], ["-xu"], ["-u", "all"], ["--update-snapshots=missing"]])(
    "refuses %s",
    (...args) => {
      const r = run(args);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/Refusing --update-snapshots=/);
    },
  );

  it("runs an ordinary command, including a grep with a u in it", () => {
    for (const args of [[], ["-groute"]]) {
      const r = run(args);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/1 passed/);
    }
  });

  it("lets the baseline workflow update", () => {
    const r = run(["--update-snapshots=all"], { [BASELINES_ENV]: "1" });
    expect(r.status, r.out).toBe(0);
  });
}, 120_000);

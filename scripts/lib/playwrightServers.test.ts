import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import config from "../../playwright.config";
import {
  BASELINES_ENV,
  KNOWN,
  refuseLocalBaselines,
  requestedProjects,
  serversFor,
  snapshotUpdateMode,
} from "./playwrightServers";

// Spec 42 §E. Playwright starts every webServer in the config whatever
// --project asked for, so each app-only pass paid for a full production build
// (3,886 pages) it never used, and the baseline generator built twice.
const argv = (s: string): string[] => [
  "node",
  "playwright",
  "test",
  ...s.split(" ").filter(Boolean),
];

describe("requestedProjects", () => {
  it("reads both spellings of --project", () => {
    expect(requestedProjects(argv("--project=chromium --project mobile"))).toEqual([
      "chromium",
      "mobile",
    ]);
  });

  it("is empty when none is named: every project runs", () => {
    expect(requestedProjects(argv("e2e/smoke.spec.ts"))).toEqual([]);
  });
});

describe("serversFor", () => {
  it("starts only the dev server for the app projects", () => {
    expect(serversFor(argv("--project=chromium --project=mobile"))).toEqual(["dev"]);
  });

  it("starts only the production preview for the static project", () => {
    expect(serversFor(argv("--project=static"))).toEqual(["preview"]);
  });

  it("starts both when every project runs", () => {
    expect(serversFor(argv(""))).toEqual(["dev", "preview"]);
  });

  it("starts both when a pass names projects from each side", () => {
    expect(serversFor(argv("--project=mobile --project=static"))).toEqual(["dev", "preview"]);
  });

  it("starts both for a project name it does not recognise exactly", () => {
    // Playwright matches --project case-insensitively and by wildcard.
    for (const a of [
      "--project=Chromium",
      "--project=chrom*",
      "--project=STATIC",
      "--project=static --project=Chromium", // one loose name beside an exact one
    ]) {
      expect(serversFor(argv(a)), a).toEqual(["dev", "preview"]);
    }
  });

  it("reads every value after a space-spelled --project", () => {
    // `--project mobile static` runs both, so both servers are needed.
    expect(requestedProjects(argv("--project mobile static --workers 1"))).toEqual([
      "mobile",
      "static",
    ]);
    expect(serversFor(argv("--project mobile static"))).toEqual(["dev", "preview"]);
  });
});

describe("the project names this module knows", () => {
  it("are exactly the projects playwright.config.ts defines", () => {
    // A renamed or added project would otherwise count as inexact and start
    // both servers, including the production build this module avoids.
    expect((config.projects ?? []).map((p) => p.name).sort()).toEqual([...KNOWN].sort());
  });
});

describe("snapshotUpdateMode / refuseLocalBaselines (spec 42 §E)", () => {
  it("reads every spelling Playwright accepts", () => {
    expect(snapshotUpdateMode(argv("e2e/x.spec.ts"))).toBeUndefined();
    expect(snapshotUpdateMode(argv("-u"))).toBe("changed");
    expect(snapshotUpdateMode(argv("--update-snapshots"))).toBe("changed");
    expect(snapshotUpdateMode(argv("--update-snapshots=all"))).toBe("all");
    expect(snapshotUpdateMode(argv("--update-snapshots none"))).toBe("none");
    expect(snapshotUpdateMode(argv("-u all"))).toBe("all");
    expect(snapshotUpdateMode(argv("-uall"))).toBe("all"); // attached
    expect(snapshotUpdateMode(argv("-xu"))).toBe("changed"); // grouped short flags
    // Playwright takes the next non-flag argument as the mode (and rejects a file).
    expect(snapshotUpdateMode(argv("-u e2e/x.spec.ts"))).toBe("e2e/x.spec.ts");
    expect(snapshotUpdateMode(argv("-u --project=static"))).toBe("changed");
    // A value of another option is not the flag.
    expect(snapshotUpdateMode(argv("-g -u"))).toBeUndefined();
    expect(snapshotUpdateMode(argv("--ui"))).toBeUndefined();
  });

  it("refuses a rewrite outside the baseline workflow, allows it there", () => {
    for (const a of ["-u", "--update-snapshots=all", "-u changed", "-uall", "-u missing"]) {
      expect(refuseLocalBaselines(argv(a), {}), a).toMatch(/^Refusing --update-snapshots=/);
      expect(refuseLocalBaselines(argv(a), { [BASELINES_ENV]: "1" }), a).toBeUndefined();
    }
    for (const a of ["", "--update-snapshots=none"]) {
      expect(refuseLocalBaselines(argv(a), {}), a).toBeUndefined();
    }
  });

  it("playwright.config.ts applies it to the arguments Playwright actually got", () => {
    // `--list` loads the config without starting a server or a browser.
    const root = resolve(__dirname, "../..");
    const cli = resolve(root, "node_modules/@playwright/test/cli.js");
    const env = { ...process.env, CI: "", [BASELINES_ENV]: "" };
    const run = (args: string[]) =>
      execFileSync(process.execPath, [cli, "test", "--list", ...args], {
        cwd: root,
        env,
        stdio: "pipe",
      });
    expect(() => run(["-uall"])).toThrow(/Refusing --update-snapshots=all/);
    expect(() => run([])).not.toThrow();
  }, 60_000);

  it("playwright.config.ts never writes a baseline it was not asked for", () => {
    // Playwright's default, "missing", would give a new screenshot its first
    // baseline from this machine's fonts.
    expect(config.updateSnapshots).toBe("none");
  });
});

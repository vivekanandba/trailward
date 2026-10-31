import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import config from "../../playwright.config";
import {
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
    expect(snapshotUpdateMode(argv("-u e2e/x.spec.ts"))).toBe("changed"); // a file, not a mode
  });

  it("refuses a rewrite outside the baseline workflow, allows it there", () => {
    for (const a of ["-u", "--update-snapshots=all", "-u changed"]) {
      expect(refuseLocalBaselines(argv(a), {}), a).toMatch(/^Refusing --update-snapshots=/);
      expect(refuseLocalBaselines(argv(a), { TRAILWARD_BASELINES: "1" }), a).toBeUndefined();
    }
    // These write no committed baseline over another: missing is the default.
    for (const a of ["", "--update-snapshots=none", "-u missing"]) {
      expect(refuseLocalBaselines(argv(a), {}), a).toBeUndefined();
    }
  });

  it("playwright.config.ts applies it to the arguments Playwright actually got", () => {
    // `--list` loads the config without starting a server or a browser.
    const root = resolve(__dirname, "../..");
    const env = { ...process.env, CI: "", TRAILWARD_BASELINES: "" };
    const run = (args: string[]) =>
      execFileSync("npx", ["playwright", "test", "--list", ...args], {
        cwd: root,
        env,
        stdio: "pipe",
      });
    expect(() => run(["-u"])).toThrow(/Refusing --update-snapshots=changed/);
    expect(() => run([])).not.toThrow();
  }, 60_000);
});

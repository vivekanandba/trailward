import { describe, it, expect } from "vitest";
import config from "../../playwright.config";
import { KNOWN, requestedProjects, serversFor } from "./playwrightServers";

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

describe("playwright.config.ts snapshot defaults (spec 42 §E)", () => {
  it("playwright.config.ts never writes a baseline it was not asked for", () => {
    // Playwright's default, "missing", would give a new screenshot its first
    // baseline from this machine's fonts.
    expect(config.updateSnapshots).toBe("none");
  });
});

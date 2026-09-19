import { describe, it, expect } from "vitest";
import { classifyLink, sameTarget, summarise } from "./linkcheck";

describe("classifyLink (spec 37)", () => {
  it("treats 2xx as ok", () => {
    expect(classifyLink({ status: 200, url: "https://a/x", finalUrl: "https://a/x" })).toBe("ok");
    expect(classifyLink({ status: 204, url: "https://a/x", finalUrl: "https://a/x" })).toBe("ok");
  });

  it("reports a genuine redirect as moved, but a fragment difference as ok", () => {
    expect(classifyLink({ status: 200, url: "https://a/x", finalUrl: "https://a/y" })).toBe(
      "moved",
    );
    // fetch never sends the fragment, so #anchor always looks like a redirect.
    expect(classifyLink({ status: 200, url: "https://a/x#frag", finalUrl: "https://a/x" })).toBe(
      "ok",
    );
    // A trailing slash is not a move either.
    expect(classifyLink({ status: 200, url: "https://a/x/", finalUrl: "https://a/x" })).toBe("ok");
  });

  it("classifies bot walls as UNVERIFIED, not failed — a checker that cries wolf is ignored", () => {
    for (const status of [403, 429, 999]) {
      expect(classifyLink({ status, url: "https://a/x", finalUrl: "https://a/x" })).toBe(
        "unverified",
      );
    }
  });

  it("fails on 404 and 5xx and on a thrown network error", () => {
    expect(classifyLink({ status: 404, url: "https://a/x", finalUrl: "https://a/x" })).toBe(
      "failed",
    );
    expect(classifyLink({ status: 500, url: "https://a/x", finalUrl: "https://a/x" })).toBe(
      "failed",
    );
    expect(classifyLink({ status: 0, url: "https://a/x", finalUrl: "", error: "ENOTFOUND" })).toBe(
      "failed",
    );
  });
});

describe("sameTarget", () => {
  it("ignores fragments and trailing slashes, respects everything else", () => {
    expect(sameTarget("https://a/x#f", "https://a/x")).toBe(true);
    expect(sameTarget("https://a/x/", "https://a/x")).toBe(true);
    expect(sameTarget("https://a/x", "https://a/y")).toBe(false);
    expect(sameTarget("https://a/x?q=1", "https://a/x")).toBe(false);
  });
});

describe("summarise (advisory — visible, never blocking)", () => {
  it("counts each outcome and never signals failure through an exit code", () => {
    const report = summarise([
      { url: "https://a/1", outcome: "ok" },
      { url: "https://a/2", outcome: "failed", status: 404 },
      { url: "https://a/3", outcome: "unverified", status: 403 },
      { url: "https://a/4", outcome: "moved", finalUrl: "https://a/4x" },
    ]);
    expect(report.counts).toEqual({ ok: 1, failed: 1, unverified: 1, moved: 1 });
    expect(report.text).toContain("1 failed");
    expect(report.text).toContain("https://a/2");
    // Advisory: a third party's outage must not block a merge.
    expect(report.exitCode).toBe(0);
  });
});

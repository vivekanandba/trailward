// constitution-ok: this file tests the gate, so it must contain the local
// paths and fabricated rule ids the gate is built to reject.
import { describe, it, expect } from "vitest";
import {
  parseLock,
  findLocalPaths,
  findUnknownRuleIds,
  findCopiedText,
  exitCodeFor,
  isExempt,
  decodeGhContent,
  type RemoteStatus,
} from "./constitution";

const VALID = JSON.stringify({
  repo: "https://github.com/vivekanandba/constitution",
  ref: "main",
  commit: "76d7593abcdef0123456789abcdef0123456789a",
  sha256: "03ab3c86dc3032cadd24daa0b1e0da6e41cd956c9aaed3d1043e678d232bb821",
});

describe("parseLock (spec 39)", () => {
  it("accepts a well-formed lock", () => {
    const lock = parseLock(VALID);
    expect(lock.repo).toContain("github.com");
    expect(lock.ref).toBe("main");
  });

  it("rejects a malformed lock, naming the field", () => {
    const bad = (over: Record<string, unknown>) =>
      JSON.stringify({ ...JSON.parse(VALID), ...over });
    expect(() => parseLock("not json")).toThrow(/lock/i);
    expect(() => parseLock(bad({ repo: "git@github.com:x/y.git" }))).toThrow(/repo/);
    expect(() => parseLock(bad({ commit: "76d7593" }))).toThrow(/commit/);
    expect(() => parseLock(bad({ sha256: "abc" }))).toThrow(/sha256/);
    expect(() => parseLock(bad({ ref: "" }))).toThrow(/ref/);
  });
});

describe("findLocalPaths (spec 39 — the local clone must never be referenced)", () => {
  it("flags a path into the local constitution clone", () => {
    expect(findLocalPaths("see ~/data-dash/constitution/CONSTITUTION.md")).toHaveLength(1);
    expect(findLocalPaths("loaded from /home/ubuntu/data-dash/constitution")).toHaveLength(1);
  });

  it("accepts the remote URL and ordinary prose", () => {
    expect(findLocalPaths("https://github.com/vivekanandba/constitution")).toEqual([]);
    expect(findLocalPaths("the engineering constitution defines CON-VER-001")).toEqual([]);
  });
});

describe("findUnknownRuleIds (spec 39 — a citation to a rule that doesn't exist reads as authority)", () => {
  const known = new Set(["CON-VER-001", "CON-COV-002", "CON-DATA-001"]);

  it("flags an id the constitution does not define", () => {
    expect(findUnknownRuleIds("we follow CON-FAKE-999 here", known)).toEqual(["CON-FAKE-999"]);
  });

  it("accepts ids the constitution defines", () => {
    expect(findUnknownRuleIds("per CON-VER-001 and CON-COV-002", known)).toEqual([]);
  });

  it("reports each unknown id once, however many times it appears", () => {
    expect(findUnknownRuleIds("CON-FAKE-999 ... CON-FAKE-999", known)).toEqual(["CON-FAKE-999"]);
  });
});

describe("findCopiedText (spec 39 — cite, never restate)", () => {
  const source =
    "A coverage floor only ratchets up. Raise it as coverage grows and never lower it to " +
    "make a red build green, because the fix belongs in the test or the code.";

  it("flags a long verbatim run lifted from the constitution", () => {
    const hits = findCopiedText(
      "Our policy: raise it as coverage grows and never lower it to make a red build green, because the fix belongs in the test.",
      source,
      12,
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("ignores a short quoted phrase", () => {
    expect(findCopiedText("we keep a coverage floor", source, 12)).toEqual([]);
  });
});

describe("exitCodeFor (spec 39 — never report success it has not earned)", () => {
  const status = (s: RemoteStatus) => s;

  it("passes on a match", () => {
    expect(exitCodeFor(status("match"), { ci: true, accessConfigured: true })).toBe(0);
  });

  it("FAILS on a mismatch, in CI and locally alike — the rules moved", () => {
    expect(exitCodeFor(status("mismatch"), { ci: true, accessConfigured: true })).toBe(1);
    expect(exitCodeFor(status("mismatch"), { ci: false, accessConfigured: true })).toBe(1);
  });

  it("fails in CI when access IS configured but the remote could not be read", () => {
    expect(exitCodeFor(status("unreachable"), { ci: true, accessConfigured: true })).toBe(1);
  });

  it("warns rather than blocking when no access is configured yet", () => {
    // The repo is private and CI has no credential; developers must not be
    // blocked by infrastructure that hasn't landed.
    expect(exitCodeFor(status("unreachable"), { ci: true, accessConfigured: false })).toBe(0);
    expect(exitCodeFor(status("unreachable"), { ci: false, accessConfigured: false })).toBe(0);
  });
});

describe("isExempt (spec 39 — a gate with no legitimate exit gets routed around)", () => {
  it("honours a marker that states a reason", () => {
    expect(isExempt("// constitution-ok: this file tests the gate itself")).toBe(true);
  });

  it("refuses a bare marker with no reason", () => {
    expect(isExempt("// constitution-ok:")).toBe(false);
    expect(isExempt("// constitution-ok")).toBe(false);
  });

  it("is false for ordinary files", () => {
    expect(isExempt("const x = 1;")).toBe(false);
  });
});

describe("decodeGhContent (spec 39 — base64 must be joined before decoding)", () => {
  it("survives a multi-byte character split across base64 lines", () => {
    // GitHub returns base64 wrapped at 60 chars. Decoding each line to a
    // STRING separately corrupts any UTF-8 sequence that straddles a chunk
    // boundary — which the constitution is full of (— · ").
    const text = "— rules · with “smart” quotes —".repeat(12);
    const wrapped = (
      Buffer.from(text, "utf8")
        .toString("base64")
        .match(/.{1,60}/g) ?? []
    ).join("\n");
    expect(decodeGhContent(wrapped)).toBe(text);
  });

  it("handles a trailing newline and empty lines", () => {
    const b64 = Buffer.from("hello", "utf8").toString("base64");
    expect(decodeGhContent(`${b64}\n`)).toBe("hello");
  });
});

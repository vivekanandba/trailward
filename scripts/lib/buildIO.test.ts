import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeIO, memoryIO, type BuildIO } from "./buildIO";

/**
 * The seam is only worth having if the fake behaves like the real filesystem.
 * A `memoryIO` that is more forgiving than `nodeIO` makes every test that uses
 * it green for nothing — the classic seam failure, and the reason this file
 * exercises BOTH implementations through the SAME table (CON-COV-003: assert
 * the agreement from both sides, because the boundary is where the defect is).
 *
 * It is also the only thing that executes `nodeIO` at all; without it the real
 * implementation ships untested while the fake carries the coverage.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trailward-io-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Build the same starting state in each implementation. */
function bothWith(files: Record<string, string>): Array<[string, BuildIO, (p: string) => string]> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
  const mem = memoryIO(
    Object.fromEntries(Object.entries(files).map(([rel, body]) => [`/root/${rel}`, body])),
  );
  return [
    ["nodeIO", nodeIO, (p: string) => join(root, p)],
    ["memoryIO", mem, (p: string) => `/root/${p}`],
  ];
}

describe("BuildIO conformance — memoryIO must not be kinder than the disk", () => {
  it("reads a file that exists and throws for one that does not", () => {
    for (const [name, io, path] of bothWith({ "a/x.txt": "hello" })) {
      expect(io.readFile(path("a/x.txt")), name).toBe("hello");
      expect(() => io.readFile(path("a/missing.txt")), name).toThrow();
    }
  });

  it("reports a DIRECTORY as existing, not just a file", () => {
    // build-pages guards on `exists(distDir)`. When memoryIO answered false for
    // every directory, that guard was inexpressible through the seam and a test
    // written against the fake would have asserted the opposite of production.
    for (const [name, io, path] of bothWith({ "dist/index.html": "<html>" })) {
      expect(io.exists(path("dist/index.html")), name).toBe(true);
      expect(io.exists(path("dist")), name).toBe(true);
      expect(io.exists(path("nope")), name).toBe(false);
    }
  });

  it("lists each direct child exactly once, never a duplicate per nested file", () => {
    for (const [name, io, path] of bothWith({
      "content/about.md": "a",
      "content/sources.md": "b",
      "content/sub/one.md": "c",
      "content/sub/two.md": "d",
    })) {
      expect([...io.listDir(path("content"))].sort(), name).toEqual([
        "about.md",
        "sources.md",
        "sub",
      ]);
    }
  });

  it("THROWS on listing a missing directory rather than returning []", () => {
    // Returning [] here is how `npm run build:pages` exited 0 having written no
    // /about/ or /sources/ while the sitemap still advertised them.
    for (const [name, io, path] of bothWith({ "content/about.md": "a" })) {
      expect(() => io.listDir(path("absent")), name).toThrow();
    }
  });

  it("writes a file, creating parent directories on the way", () => {
    for (const [name, io, path] of bothWith({})) {
      io.writeFile(path("deep/nested/out.json"), "{}");
      expect(io.readFile(path("deep/nested/out.json")), name).toBe("{}");
    }
  });

  it("removes a directory tree and tolerates one that is already gone", () => {
    for (const [name, io, path] of bothWith({ "junk/a.txt": "a", "junk/b/c.txt": "c" })) {
      io.removeDir(path("junk"));
      expect(io.exists(path("junk/a.txt")), name).toBe(false);
      expect(() => io.removeDir(path("junk")), name).not.toThrow();
    }
  });
});

describe("nodeIO.removeDir refuses to follow a link out of the repo (CON-PROC-006)", () => {
  it("refuses a symlinked target instead of deleting what it points at", () => {
    const victim = join(root, "victim");
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, "precious.txt"), "do not delete", "utf8");
    symlinkSync(victim, join(root, "link"));

    expect(() => nodeIO.removeDir(join(root, "link"))).toThrow(/refusing/);
    expect(existsSync(join(victim, "precious.txt"))).toBe(true);
  });

  it("refuses when a PARENT is a symlink — a string check cannot see this", () => {
    // <repo>/dist -> /elsewhere passes any spelling test for "<repo>/dist/t"
    // while rm -rf destroys /elsewhere/t.
    const elsewhere = join(root, "elsewhere");
    mkdirSync(join(elsewhere, "t"), { recursive: true });
    writeFileSync(join(elsewhere, "t", "precious.txt"), "do not delete", "utf8");
    mkdirSync(join(root, "repo"), { recursive: true });
    symlinkSync(elsewhere, join(root, "repo", "dist"));

    expect(() => nodeIO.removeDir(join(root, "repo", "dist", "t"))).toThrow(/refusing/);
    expect(existsSync(join(elsewhere, "t", "precious.txt"))).toBe(true);
  });

  it("still removes an ordinary directory", () => {
    mkdirSync(join(root, "dist", "t"), { recursive: true });
    writeFileSync(join(root, "dist", "t", "page.html"), "x", "utf8");
    nodeIO.removeDir(join(root, "dist", "t"));
    expect(existsSync(join(root, "dist", "t"))).toBe(false);
  });
});

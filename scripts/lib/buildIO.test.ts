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

/**
 * Build the same starting state in each implementation. A key ending in "/"
 * means an EMPTY directory in both — the case that cannot be expressed with
 * files alone, and the one that differs from a missing directory.
 */
function bothWith(files: Record<string, string>): Array<[string, BuildIO, (p: string) => string]> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    if (rel.endsWith("/")) {
      mkdirSync(abs, { recursive: true });
      continue;
    }
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

  it("distinguishes an EMPTY directory from a missing one", () => {
    // `rm content/*.md` leaves the directory in place: listDir returns [] and
    // the build writes no /about/ or /sources/ while the sitemap advertises
    // them. The fake has to be able to reach that state, or the tool-level
    // guard against it can never be tested.
    for (const [name, io, path] of bothWith({ "content/": "", "other/a.md": "a" })) {
      expect(io.exists(path("content")), name).toBe(true);
      expect(io.listDir(path("content")), name).toEqual([]);
      expect(() => io.listDir(path("gone")), name).toThrow();
    }
  });

  it("does not mistake a name PREFIX for a directory", () => {
    // Without the trailing slash in the prefix test, `/a/foo` reads as a
    // directory because `/a/foobar/x` starts with `/a/foo`.
    for (const [name, io, path] of bothWith({ "a/foobar/x.txt": "x" })) {
      expect(io.exists(path("a/foo")), name).toBe(false);
      expect(() => io.listDir(path("a/foo")), name).toThrow();
      expect(io.exists(path("a/foobar")), name).toBe(true);
    }
  });

  it("writes a file, creating parent directories on the way", () => {
    for (const [name, io, path] of bothWith({})) {
      io.writeFile(path("deep/nested/out.json"), "{}");
      expect(io.readFile(path("deep/nested/out.json")), name).toBe("{}");
    }
  });

  it("removes a directory tree and tolerates one that is already gone", () => {
    for (const [name, io, path] of bothWith({
      "junk/a.txt": "a",
      "junk/b/c.txt": "c",
      "junk/empty/": "",
    })) {
      io.removeDir(path("junk"), path(""));
      expect(io.exists(path("junk/a.txt")), name).toBe(false);
      // The empty subdirectory must go too. memoryIO tracked seeded empty
      // directories separately and never cleared them, so it reported a
      // removed directory as still existing — the opposite of the disk, in
      // precisely the state the empty-directory seeding was added to express.
      expect(io.exists(path("junk/empty")), name).toBe(false);
      expect(() => io.listDir(path("junk/empty")), name).toThrow();
      expect(() => io.removeDir(path("junk"), path("")), name).not.toThrow();
    }
  });

  it("refuses to remove a path OUTSIDE the containment root", () => {
    for (const [name, io, path] of bothWith({ "repo/dist/t/p.html": "x", "outside/x.txt": "y" })) {
      expect(() => io.removeDir(path("outside"), path("repo")), name).toThrow(/refusing/);
      expect(io.exists(path("outside/x.txt")), name).toBe(true);
      io.removeDir(path("repo/dist/t"), path("repo"));
      expect(io.exists(path("repo/dist/t/p.html")), name).toBe(false);
    }
  });
});

describe("nodeIO.removeDir refuses to follow a link out of the repo (CON-PROC-006)", () => {
  it("refuses a symlinked target instead of deleting what it points at", () => {
    const victim = join(root, "victim");
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, "precious.txt"), "do not delete", "utf8");
    symlinkSync(victim, join(root, "link"));

    expect(() => nodeIO.removeDir(join(root, "link"), root)).toThrow(/refusing/);
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

    expect(() => nodeIO.removeDir(join(root, "repo", "dist", "t"), join(root, "repo"))).toThrow(
      /refusing/,
    );
    expect(existsSync(join(elsewhere, "t", "precious.txt"))).toBe(true);
  });

  it("still removes an ordinary directory", () => {
    mkdirSync(join(root, "dist", "t"), { recursive: true });
    writeFileSync(join(root, "dist", "t", "page.html"), "x", "utf8");
    nodeIO.removeDir(join(root, "dist", "t"), root);
    expect(existsSync(join(root, "dist", "t"))).toBe(false);
  });

  it("still removes when an ANCESTOR of the repo is a symlink", () => {
    // The first version of this guard compared realpath(p) with resolve(p),
    // which also refused a perfectly ordinary checkout under a symlinked
    // parent — a symlinked ~/work, a container bind-mount, macOS /tmp. That
    // fails a build for a problem the developer does not have (CON-VER-005).
    mkdirSync(join(root, "real-repos", "trailward", "dist", "t"), { recursive: true });
    writeFileSync(join(root, "real-repos", "trailward", "dist", "t", "p.html"), "x", "utf8");
    symlinkSync(join(root, "real-repos"), join(root, "repos"));

    const repo = join(root, "repos", "trailward");
    expect(() => nodeIO.removeDir(join(repo, "dist", "t"), repo)).not.toThrow();
    expect(existsSync(join(root, "real-repos", "trailward", "dist", "t"))).toBe(false);
  });
});

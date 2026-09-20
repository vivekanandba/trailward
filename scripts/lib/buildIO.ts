/**
 * The I/O seam for build tools (spec 40).
 *
 * Every build tool exports `run(io)`; `main()` is a thin CLI wrapper that
 * supplies the real filesystem. Tests supply an in-memory implementation and
 * assert the tool's *contract* — what it wrote, whether it validated first,
 * whether it refuses to write on total failure — rather than its internals.
 *
 * This extends a pattern the project already uses for fetchers
 * (`fetchMonthlyRain(cells, getJson = …)`) rather than inventing one.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export interface BuildIO {
  readFile(path: string): string;
  writeFile(path: string, body: string): void;
  exists(path: string): boolean;
  /**
   * Remove a directory tree. Implementations MUST refuse a path that resolves
   * somewhere other than where it is written — see `nodeIO.removeDir`.
   */
  removeDir(path: string): void;
  /** Entries directly under `path`. Throws if it does not exist. */
  listDir(path: string): string[];
  log(line: string): void;
}

/** The real filesystem. */
export const nodeIO: BuildIO = {
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, body) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, "utf8");
  },
  exists: (p) => existsSync(p),
  removeDir(p) {
    const st = lstatSync(p, { throwIfNoEntry: false });
    if (!st) return; // already absent — removing nothing is the intended state
    // A string check on the path cannot see a symlink: `<repo>/dist -> /elsewhere`
    // passes any spelling test while rm -rf destroys /elsewhere. Resolve the
    // path and refuse when it lands somewhere other than where it is written,
    // so the guard holds by construction rather than by the caller's care
    // (CON-PROC-006).
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to remove a symlink: ${p}`);
    }
    const real = realpathSync(p);
    if (real !== resolve(p)) {
      throw new Error(`refusing to remove ${p}: it resolves to ${real}`);
    }
    rmSync(p, { recursive: true, force: true });
  },
  listDir: (p) => readdirSync(p),
  log: (line) => console.log(line),
};

/**
 * In-memory I/O for tests. `files` starts seeded and ends holding exactly what
 * the tool wrote, so a test can assert the artefact rather than mock calls.
 */
export function memoryIO(seed: Record<string, string> = {}): BuildIO & {
  files: Map<string, string>;
  logs: string[];
} {
  // A seed key ending in "/" is an EMPTY directory. Without this the fake
  // cannot represent `content/` existing but holding nothing — a real state on
  // disk (`rm content/*.md`) whose behaviour differs from a missing directory:
  // nodeIO.listDir returns [] rather than throwing.
  const dirs = new Set(
    Object.keys(seed)
      .filter((k) => k.endsWith("/"))
      .map((k) => k.replace(/\/+$/, "")),
  );
  const files = new Map(Object.entries(seed).filter(([k]) => !k.endsWith("/")));
  const logs: string[] = [];
  // The trailing slash matters: without it `/a/foo` would report as a directory
  // merely because `/a/foobar/x` starts with `/a/foo`.
  const isDir = (path: string): boolean =>
    dirs.has(path) || [...files.keys()].some((k) => k.startsWith(`${path}/`));
  return {
    files,
    logs,
    readFile(path) {
      const body = files.get(path);
      if (body === undefined) throw new Error(`ENOENT: ${path}`);
      return body;
    },
    writeFile(path, body) {
      files.set(path, body);
    },
    // nodeIO.exists is true for a directory, so this must be too: a fake that
    // is stricter than the real thing makes a passing test meaningless.
    exists: (path) => files.has(path) || isDir(path),
    removeDir(path) {
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    listDir(path) {
      if (!isDir(path)) throw new Error(`ENOENT: ${path}`);
      return [
        ...new Set(
          [...files.keys()]
            .filter((k) => k.startsWith(`${path}/`))
            .map((k) => k.slice(path.length + 1).split("/")[0]),
        ),
      ];
    },
    log: (line) => logs.push(line),
  };
}

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
  const files = new Map(Object.entries(seed));
  const logs: string[] = [];
  // A directory exists here exactly when a file lives under it — the same
  // condition the real filesystem reports. Kept as a helper rather than a
  // separate set so the two can never drift apart.
  const isDir = (path: string): boolean => [...files.keys()].some((k) => k.startsWith(`${path}/`));
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

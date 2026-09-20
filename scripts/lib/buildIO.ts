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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface BuildIO {
  readFile(path: string): string;
  writeFile(path: string, body: string): void;
  exists(path: string): boolean;
  /** Remove a directory tree. Implementations must refuse suspicious paths. */
  removeDir(path: string): void;
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
  removeDir: (p) => rmSync(p, { recursive: true, force: true }),
  listDir: (p) => (existsSync(p) ? readdirSync(p) : []),
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
    exists: (path) => files.has(path),
    removeDir(path) {
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    listDir: (path) =>
      [...files.keys()]
        .filter((k) => k.startsWith(`${path}/`))
        .map((k) => k.slice(path.length + 1).split("/")[0]),
    log: (line) => logs.push(line),
  };
}

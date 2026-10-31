/**
 * Which web servers a Playwright run needs (spec 42 §E). Playwright starts
 * every `webServer` in the config whatever `--project` asked for, so an
 * app-only pass paid for a full production build of 3,886 pages it never
 * used. The config asks this instead.
 */

/**
 * Projects named with `--project=x` or `--project x y …` (the space spelling
 * takes every value up to the next flag); empty means all of them.
 */
export function requestedProjects(argv: string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a.startsWith("--project=")) out.push(a.slice("--project=".length));
    else if (a === "--project") {
      for (let j = i + 1; j < argv.length && !argv[j].startsWith("-"); j++) out.push(argv[j]);
    }
  });
  return out;
}

const APP = ["chromium", "mobile"];

/**
 * The app projects run against the dev server; static against `vite preview`. Playwright matches `--project` case-insensitively and
 * accepts wildcards, so anything other than an exact lower-case name starts
 * both servers: a spare server costs time, a missing one fails every test.
 */
export function serversFor(argv: string[]): ("dev" | "preview")[] {
  const asked = requestedProjects(argv);
  const exact = asked.length > 0 && asked.every((p) => [...APP, "static"].includes(p));
  if (!exact) return ["dev", "preview"];
  const servers: ("dev" | "preview")[] = [];
  if (asked.some((p) => APP.includes(p))) servers.push("dev");
  if (asked.includes("static")) servers.push("preview");
  return servers;
}

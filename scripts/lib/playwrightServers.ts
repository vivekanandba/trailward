/**
 * Which web servers a Playwright run needs (spec 42 §E). Playwright starts
 * every `webServer` in the config whatever `--project` asked for, so an
 * app-only pass paid for a full production build of 3,886 pages it never
 * used. The config asks this instead.
 */

/** Projects named with `--project=x` or `--project x`; empty means all of them. */
export function requestedProjects(argv: string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a.startsWith("--project=")) out.push(a.slice("--project=".length));
    else if (a === "--project" && argv[i + 1]) out.push(argv[i + 1]);
  });
  return out;
}

/** The app projects run against the dev server; static (and pwa) against `vite preview`. */
export function serversFor(argv: string[]): ("dev" | "preview")[] {
  const asked = requestedProjects(argv);
  const all = asked.length === 0;
  const servers: ("dev" | "preview")[] = [];
  if (all || asked.some((p) => p === "chromium" || p === "mobile")) servers.push("dev");
  if (all || asked.includes("static")) servers.push("preview");
  return servers;
}

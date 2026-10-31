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
const STATIC = "static";
export const KNOWN = [...APP, STATIC];

/**
 * The app projects run against the dev server; static against `vite preview`. Playwright matches `--project` case-insensitively and
 * accepts wildcards, so anything other than an exact lower-case name starts
 * both servers: a spare server costs time, a missing one fails every test.
 */
export function serversFor(argv: string[]): ("dev" | "preview")[] {
  const asked = requestedProjects(argv);
  const exact = asked.length > 0 && asked.every((p) => KNOWN.includes(p));
  if (!exact) return ["dev", "preview"];
  const servers: ("dev" | "preview")[] = [];
  if (asked.some((p) => APP.includes(p))) servers.push("dev");
  if (asked.includes(STATIC)) servers.push("preview");
  return servers;
}

/** Set only by the "Update visual baselines" workflow, which renders on the pinned image. */
export const BASELINES_ENV = "TRAILWARD_BASELINES";

// Options whose next argument is their value, so a `-u` there is a value (a
// grep pattern, say), not the flag. The ones a person plausibly puts before -u.
const TAKES_VALUE = new Set(["-c", "--config", "-g", "--grep", "--grep-invert", "-j", "--workers"]);

/**
 * The snapshot update mode the arguments ask for, as Playwright's parser reads
 * `-u` / `--update-snapshots [mode]`: an attached value (`-uall`, `=all`), the
 * next argument when it is not a flag (Playwright rejects one that is not a
 * mode), or "changed" for a bare flag; `u` last in a short group (`-xu`) too.
 * Undefined when neither is given.
 */
export function snapshotUpdateMode(argv: string[]): string | undefined {
  let mode: string | undefined;
  argv.forEach((a, i) => {
    if (TAKES_VALUE.has(argv[i - 1])) return;
    const long = /^--update-snapshots(?:=(.*))?$/.exec(a);
    const short = /^-[a-zA-Z]*u(.*)$/.exec(a);
    if (!long && !(short && !a.startsWith("--"))) return;
    const attached = long ? long[1] : short![1].replace(/^=/, "") || undefined;
    const next = argv[i + 1];
    mode = attached ?? (next !== undefined && !next.startsWith("-") ? next : "changed");
  });
  return mode;
}

/**
 * Why this run must not start, or undefined. A run that rewrites committed
 * screenshots anywhere but the baseline workflow writes this machine's font
 * rendering into them (spec 42 §E). Read from the arguments Playwright got,
 * so a script, a shell wrapper or `npm run x -- -u` does not escape it. Not
 * seen: UI mode's "update snapshots" toggle, which never reaches argv; that
 * one is review-enforced (spec 42 §E).
 */
export function refuseLocalBaselines(
  argv: string[],
  env: Record<string, string | undefined>,
): string | undefined {
  const mode = snapshotUpdateMode(argv);
  if (mode === undefined || mode === "none") return undefined;
  if (env[BASELINES_ENV] === "1") return undefined;
  return (
    `Refusing --update-snapshots=${mode}: baselines come only from the "Update visual ` +
    `baselines" workflow, on the pinned CI image (spec 42 §E). A failing run leaves its ` +
    `actual and diff images in test-results/.`
  );
}

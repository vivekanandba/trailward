/**
 * check-size — the size budget (spec 44 rule D5, register row 4). Delight pays
 * its weight: every byte the app ships is measured after `npm run build` and
 * compared against `size-budget.json`.
 *
 *   npm run build && npm run check:size
 *
 * Three numbers, because they cost a visitor differently:
 * - initialJsCss: the JS and CSS `index.html` references, which the first
 *   paint waits for;
 * - totalJsCss: every JS and CSS file, lazy chunks included;
 * - fonts: every woff2 (the latin-ext faces load only when a name needs them).
 *
 * Sizes are apparent bytes (`stat`), not `du`'s block count. Raising a budget
 * is a reviewed change in the PR that needs it; lowering it after a saving is
 * how the budget ratchets down (spec 44).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

export interface SizeIO {
  listAssets(): { name: string; bytes: number }[];
  readIndexHtml(): string;
  readBudget(): string | undefined;
  log(line: string): void;
}

export interface SizeReport {
  initialJsCss: number;
  totalJsCss: number;
  fonts: number;
}

const CATEGORIES: (keyof SizeReport)[] = ["initialJsCss", "totalJsCss", "fonts"];

const isCode = (name: string): boolean => /\.(js|css)$/.test(name);

/** The asset file names `index.html` references, in order. */
export function initialAssets(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"/]+)"/g)].map((m) => m[1]);
}

export function measure(io: SizeIO): SizeReport {
  const assets = io.listAssets();
  const initial = new Set(initialAssets(io.readIndexHtml()));
  const sum = (pick: (name: string) => boolean): number =>
    assets.filter((a) => pick(a.name)).reduce((n, a) => n + a.bytes, 0);
  return {
    initialJsCss: sum((n) => isCode(n) && initial.has(n)),
    totalJsCss: sum(isCode),
    fonts: sum((n) => n.endsWith(".woff2")),
  };
}

/** One line per exceeded budget. Throws on a budget missing a category. */
export function judge(usage: SizeReport, budget: SizeReport): string[] {
  const out: string[] = [];
  for (const c of CATEGORIES) {
    if (typeof budget[c] !== "number") {
      throw new Error(`size-budget.json has no number for "${c}"`);
    }
    if (usage[c] > budget[c]) {
      out.push(`${c}: ${usage[c]} B is over the ${budget[c]} B budget by ${usage[c] - budget[c]} B`);
    }
  }
  return out;
}

export function runCheckSize(io: SizeIO): number {
  const raw = io.readBudget();
  if (raw === undefined) {
    io.log("[size] size-budget.json is missing — there is nothing to check against");
    return 1;
  }
  const html = io.readIndexHtml();
  const referenced = initialAssets(html);
  if (referenced.length === 0) {
    io.log("[size] dist/index.html references no asset — run npm run build first");
    return 1;
  }
  const names = new Set(io.listAssets().map((a) => a.name));
  const absent = referenced.filter((r) => !names.has(r));
  if (absent.length > 0) {
    io.log(`[size] dist/index.html references assets that are not there: ${absent.join(", ")}`);
    return 1;
  }

  const usage = measure(io);
  let failures: string[];
  try {
    failures = judge(usage, JSON.parse(raw) as SizeReport);
  } catch (err) {
    io.log(`[size] ${(err as Error).message}`);
    return 1;
  }
  const budget = JSON.parse(raw) as SizeReport;
  for (const c of CATEGORIES) {
    io.log(`[size] ${c}: ${usage[c]} B of ${budget[c]} B (${budget[c] - usage[c]} B headroom)`);
  }
  for (const f of failures) io.log(`[size] OVER BUDGET — ${f}`);
  return failures.length > 0 ? 1 : 0;
}

export function nodeSizeIO(root: string): SizeIO {
  const assets = join(root, "dist/assets");
  const budget = join(root, "size-budget.json");
  return {
    listAssets: () =>
      readdirSync(assets)
        .map((name) => ({ name, bytes: statSync(join(assets, name)).size }))
        .filter((a) => statSync(join(assets, a.name)).isFile()),
    readIndexHtml: () => readFileSync(join(root, "dist/index.html"), "utf8"),
    readBudget: () => (existsSync(budget) ? readFileSync(budget, "utf8") : undefined),
    log: (l) => console.log(l),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    process.exit(runCheckSize(nodeSizeIO(root)));
  } catch (err) {
    console.error(`[size] ${(err as Error).message}`);
    process.exit(1);
  }
}

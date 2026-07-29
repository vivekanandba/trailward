/**
 * feedback-list — read submissions back from the Neon feedback store (spec 29).
 * Uses the OWNER connection string from the environment — never committed,
 * never shipped to the browser (the browser only ever holds the insert-only
 * role from db/feedback-schema.sql).
 *
 *   TRAILWARD_DATABASE_URL=postgres://… npm run feedback:list          # recent 50
 *   TRAILWARD_DATABASE_URL=postgres://… npm run feedback:list -- --names
 *     → only name suggestions for terrain-detected pins, formatted so a good
 *       one can be applied by hand (and build:names will never overwrite it).
 */
import { pathToFileURL } from "node:url";

interface Row {
  id: string;
  created_at: string;
  kind: string;
  message: string;
  trek_name: string | null;
  place: string | null;
  email: string | null;
  page_url: string | null;
  reviewed: boolean;
}

/** Pure: one row → a compact terminal block. */
export function formatRow(r: Row): string {
  const head = `${r.created_at.slice(0, 16).replace("T", " ")}  [${r.kind}]${r.reviewed ? "" : "  • new"}`;
  const bits = [
    r.trek_name ? `trek: ${r.trek_name}` : "",
    r.place ? `place: ${r.place}` : "",
    r.email ? `from: ${r.email}` : "",
  ].filter(Boolean);
  return [head, bits.join("  ·  "), `  ${r.message.replace(/\s+/g, " ").slice(0, 300)}`]
    .filter(Boolean)
    .join("\n");
}

/** Pure: does a message look like a spec-28 name suggestion for a detected pin? */
export function isNameSuggestion(r: Pick<Row, "kind" | "message">): boolean {
  return r.kind === "suggest-trek" && /\bd12-[\d-]+--\w+/.test(r.message);
}

async function query(connString: string, sql: string): Promise<Row[]> {
  const host = new URL(connString.replace(/^postgres(ql)?:/, "https:")).hostname;
  const res = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": connString },
    body: JSON.stringify({ query: sql, params: [] }),
  });
  if (!res.ok) throw new Error(`Neon HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { rows?: Row[] };
  return json.rows ?? [];
}

async function main(): Promise<void> {
  const connString = process.env.TRAILWARD_DATABASE_URL;
  if (!connString) {
    throw new Error(
      "Set TRAILWARD_DATABASE_URL to your Neon OWNER connection string (Neon console → Connect).",
    );
  }
  const namesOnly = process.argv.includes("--names");
  const rows = await query(
    connString,
    "SELECT id, created_at, kind, message, trek_name, place, email, page_url, reviewed " +
      "FROM feedback ORDER BY created_at DESC LIMIT 200",
  );
  const shown = namesOnly ? rows.filter(isNameSuggestion) : rows.slice(0, 50);
  if (shown.length === 0) {
    console.log(namesOnly ? "No name suggestions yet." : "No feedback yet.");
    return;
  }
  for (const r of shown) {
    console.log(formatRow(r));
    console.log("");
  }
  console.log(`${shown.length} shown (${rows.length} fetched).`);
}

// Only run when invoked as a CLI — importing this module (tests) must not
// hit the database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

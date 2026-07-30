/**
 * apply-name-issues — turns accepted GitHub "name-suggestion" issues into real
 * pin names (spec 29). Run weekly by .github/workflows/apply-suggestions.yml
 * (or by hand with `gh` authenticated):
 *
 *   npm run apply:names
 *
 * For each open issue labelled `name-suggestion`:
 *  - parse the issue-form body (### Pin id / ### Suggested name);
 *  - validate: the pin exists in scripts/detected/india-detected.json and the
 *    name is sane;
 *  - valid → record in the committed scripts/detected/human-names.json, rename
 *    the summit + its baked treks.json records (with "via issue #N" provenance),
 *    close the issue with a thank-you;
 *  - invalid → comment what's missing, label `needs-info`, leave open.
 *
 * Human names are durable: toDetectedTreks applies human-names.json on every
 * pipeline regeneration, and build:names never overwrites a name that no
 * longer starts with "Unnamed".
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { Trek } from "../src/lib/trek";
import { validateDataset } from "../src/lib/trek";
import type { DetectedSummit } from "./build-detect";

const here = dirname(fileURLToPath(import.meta.url));
const detectedFile = resolve(here, "detected/india-detected.json");
const humanNamesFile = resolve(here, "detected/human-names.json");
const treksFile = resolve(here, "../src/data/treks.json");

export interface Suggestion {
  pinId: string;
  name: string;
}

/**
 * Pure: parse a GitHub issue-form body. Forms render as `### <Label>\n\n<value>`
 * blocks; `_No response_` marks an empty optional field.
 */
export function parseNameIssueBody(body: string): Suggestion | undefined {
  const field = (label: string): string | undefined => {
    const re = new RegExp(`###\\s*${label}\\s*\\n+([^\\n#]*)`, "i");
    const m = re.exec(body);
    const v = m?.[1]?.trim();
    return v && v !== "_No response_" ? v : undefined;
  };
  const pinId = field("Pin id");
  const name = field("Suggested name");
  if (!pinId || !name) return undefined;
  return { pinId: pinId.trim(), name: name.trim() };
}

/** Pure: is this suggestion applicable? Returns an error string when not. */
export function validateSuggestion(s: Suggestion, knownPinIds: Set<string>): string | undefined {
  if (!/^d12-[\d-]+$/.test(s.pinId)) {
    return `pin id \`${s.pinId}\` doesn't look like a terrain-detected pin (expected \`d12-…\`)`;
  }
  if (!knownPinIds.has(s.pinId)) {
    return `pin \`${s.pinId}\` isn't in the current detected-summit set`;
  }
  if (s.name.length < 3 || s.name.length > 60) return "the name must be 3–60 characters";
  if (/^unnamed/i.test(s.name)) return 'the name can\'t start with "Unnamed"';
  return undefined;
}

export type HumanNames = Record<string, { name: string; issue: number }>;

/**
 * Pure: apply community names to both datasets. Returns new arrays; summits
 * keep their objects when untouched. Used by main() and unit-tested directly.
 */
export function applyToData(
  summits: DetectedSummit[],
  treks: Trek[],
  humanNames: HumanNames,
): { summits: DetectedSummit[]; treks: Trek[] } {
  const outSummits = summits.map((s) => {
    const h = humanNames[s.id];
    if (!h) return s;
    return { ...s, name: h.name, inferredFrom: `Named by the community via issue #${h.issue}.` };
  });
  const outTreks = treks.map((t) => {
    const m = /^(d12-[\d-]+)--/.exec(t.id);
    const h = m ? humanNames[m[1]] : undefined;
    if (!h) return t;
    return { ...t, name: h.name, highlights: `Named by the community via issue #${h.issue}.` };
  });
  return { summits: outSummits, treks: outTreks };
}

interface Issue {
  number: number;
  title: string;
  body: string;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

async function main(): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY ?? "vivekanandba/trailward";
  const issues = JSON.parse(
    gh([
      "api",
      `repos/${repo}/issues?labels=name-suggestion&state=open&per_page=100`,
      "--jq",
      "[.[] | {number, title, body}]",
    ]),
  ) as Issue[];
  console.log(`[apply-names] ${issues.length} open name-suggestion issue(s).`);
  if (issues.length === 0) return;

  const summits = JSON.parse(readFileSync(detectedFile, "utf8")) as DetectedSummit[];
  const knownIds = new Set(summits.map((s) => s.id));
  const humanNames: HumanNames = existsSync(humanNamesFile)
    ? (JSON.parse(readFileSync(humanNamesFile, "utf8")) as HumanNames)
    : {};

  let applied = 0;
  for (const issue of issues) {
    const parsed = parseNameIssueBody(issue.body ?? "");
    const error = parsed
      ? validateSuggestion(parsed, knownIds)
      : "couldn't find a Pin id and a Suggested name in the issue body";
    if (!parsed || error) {
      console.log(`  #${issue.number}: needs info — ${error}`);
      gh([
        "api",
        `repos/${repo}/issues/${issue.number}/comments`,
        "-f",
        `body=Thanks! This can't be applied automatically yet: ${error}. ` +
          "Please edit the issue (keep the '### Pin id' / '### Suggested name' structure).",
      ]);
      gh(["api", `repos/${repo}/issues/${issue.number}/labels`, "-f", "labels[]=needs-info"]);
      continue;
    }
    humanNames[parsed.pinId] = { name: parsed.name, issue: issue.number };
    applied++;
    console.log(`  #${issue.number}: ${parsed.pinId} → "${parsed.name}"`);
    gh([
      "api",
      `repos/${repo}/issues/${issue.number}/comments`,
      "-f",
      `body=Applied — this pin is now named **${parsed.name}** on the map (next deploy). Thank you!`,
    ]);
    gh(["api", "--method", "PATCH", `repos/${repo}/issues/${issue.number}`, "-f", "state=closed"]);
  }
  if (applied === 0) return;

  writeFileSync(humanNamesFile, JSON.stringify(humanNames, null, 2) + "\n", "utf8");

  const treks = JSON.parse(readFileSync(treksFile, "utf8")) as Trek[];
  const applied2 = applyToData(summits, treks, humanNames);
  writeFileSync(detectedFile, JSON.stringify(applied2.summits) + "\n", "utf8");
  const ds = validateDataset(applied2.treks);
  if (!ds.ok) throw new Error(`[apply-names] dataset invalid: ${ds.error}`);
  writeFileSync(treksFile, JSON.stringify(ds.treks, null, 2) + "\n", "utf8");
  console.log(`[apply-names] applied ${applied} name(s).`);
}

// Only run when invoked as a CLI — importing this module (tests) must not
// touch GitHub.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

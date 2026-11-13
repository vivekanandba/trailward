import { describe, it, expect } from "vitest";
import {
  parseNameIssueBody,
  validateSuggestion,
  applyToData,
  triageIssues,
  closeApplied,
  type HumanNames,
} from "./apply-name-issues";

const FORM_BODY = `### Pin id

d12-2947-1901-246-99

### Coordinates

12.77849, 79.09830

### Suggested name

Bilikal Betta

### Notes (optional)

_No response_`;

describe("parseNameIssueBody", () => {
  it("extracts pin id and name from an issue-form body", () => {
    expect(parseNameIssueBody(FORM_BODY)).toEqual({
      pinId: "d12-2947-1901-246-99",
      name: "Bilikal Betta",
    });
  });

  it("returns undefined when either required field is missing or blank", () => {
    expect(parseNameIssueBody("### Pin id\n\nd12-1-1-1-1\n")).toBeUndefined();
    expect(
      parseNameIssueBody("### Pin id\n\n_No response_\n\n### Suggested name\n\nX Hill"),
    ).toBeUndefined();
    expect(parseNameIssueBody("free text, no form")).toBeUndefined();
  });
});

describe("validateSuggestion", () => {
  const known = new Set(["d12-2947-1901-246-99"]);

  it("accepts a well-formed suggestion for a known pin", () => {
    expect(
      validateSuggestion({ pinId: "d12-2947-1901-246-99", name: "Bilikal Betta" }, known),
    ).toBeUndefined();
  });

  it("rejects unknown pins, malformed ids, and bad names", () => {
    expect(validateSuggestion({ pinId: "d12-0-0-0-0", name: "X Hill" }, known)).toMatch(
      /isn't in the current/,
    );
    expect(validateSuggestion({ pinId: "gn-123", name: "X Hill" }, known)).toMatch(
      /doesn't look like/,
    );
    expect(validateSuggestion({ pinId: "d12-2947-1901-246-99", name: "Xy" }, known)).toMatch(
      /3–60/,
    );
    expect(
      validateSuggestion({ pinId: "d12-2947-1901-246-99", name: "Unnamed thing" }, known),
    ).toMatch(/Unnamed/);
  });
});

describe("applyToData", () => {
  const summit = {
    id: "d12-1-2-3-4",
    name: "Unnamed peak (~500 m)",
    lat: 13,
    lng: 77,
    elevationM: 500,
    reliefM: 150,
    prominenceProxyM: 100,
    meanSlopeDeg: 10,
    terrainConfidence: 0.9,
    discoveryScore: 0.7,
    estimatedDifficulty: "Moderate" as const,
  };
  const trek = {
    id: "d12-1-2-3-4",
    name: "Unnamed peak (~500 m)",
    lat: 13,
    lng: 77,
    cityId: "bangalore",
    tier: "discovery" as const,
    detected: true,
    sources: [],
    verified: false,
  };
  const names = { "d12-1-2-3-4": { name: "Bilikal Betta", issue: 57 } };

  it("renames matching summits and their trek records with provenance", () => {
    const out = applyToData([summit], [trek], names);
    expect(out.summits[0].name).toBe("Bilikal Betta");
    expect(out.summits[0].inferredFrom).toContain("issue #57");
    expect(out.treks[0].name).toBe("Bilikal Betta");
    expect(out.treks[0].highlights).toBe("Named by the community via issue #57.");
  });

  it("leaves unmatched records untouched (same object identity)", () => {
    const other = { ...trek, id: "gn-9" };
    const out = applyToData([{ ...summit, id: "d12-9-9-9-9" }], [other], names);
    expect(out.summits[0].name).toBe("Unnamed peak (~500 m)");
    expect(out.treks[0]).toBe(other);
  });
});

// Issue #99: an issue is thanked and closed only once its rename has landed.
// Triage runs before the data is committed; if landing is then refused, the
// rename is discarded, and a closed issue would say it had been applied.
describe("triageIssues / closeApplied", () => {
  const PIN = "d12-2947-1901-246-99";
  const fakeGh = () => {
    const calls: string[][] = [];
    return { calls, gh: (args: string[]) => (calls.push(args), "") };
  };
  const issues = [
    { number: 7, title: "name", body: FORM_BODY },
    { number: 8, title: "name", body: "no form here" },
  ];

  it("records a valid suggestion without thanking or closing its issue", () => {
    const { calls, gh } = fakeGh();
    const names: HumanNames = {};
    const applied = triageIssues(issues, new Set([PIN]), names, gh, "o/r");
    expect(applied).toEqual([{ issue: 7, pinId: PIN, name: "Bilikal Betta" }]);
    expect(names[PIN]).toEqual({ name: "Bilikal Betta", issue: 7 });
    const touched7 = calls.filter((c) => c.some((a) => a.includes("issues/7")));
    expect(touched7).toEqual([]);
  });

  it("still asks for what is missing on an invalid suggestion", () => {
    const { calls, gh } = fakeGh();
    triageIssues(issues, new Set([PIN]), {}, gh, "o/r");
    const on8 = calls.filter((c) => c.some((a) => a.includes("issues/8")));
    expect(on8.map((c) => c[1])).toEqual([
      "repos/o/r/issues/8/comments",
      "repos/o/r/issues/8/labels",
    ]);
  });

  it("thanks and closes each applied issue", () => {
    const { calls, gh } = fakeGh();
    closeApplied([{ issue: 7, pinId: PIN, name: "Bilikal Betta" }], gh, "o/r");
    expect(calls).toEqual([
      [
        "api",
        "repos/o/r/issues/7/comments",
        "-f",
        "body=Applied — this pin is now named **Bilikal Betta** on the map (next deploy). Thank you!",
      ],
      ["api", "--method", "PATCH", "repos/o/r/issues/7", "-f", "state=closed"],
    ]);
  });
});

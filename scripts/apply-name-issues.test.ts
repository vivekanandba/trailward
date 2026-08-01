import { describe, it, expect } from "vitest";
import { parseNameIssueBody, validateSuggestion, applyToData } from "./apply-name-issues";

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

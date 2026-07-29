import { describe, it, expect } from "vitest";
import { formatRow, isNameSuggestion } from "./feedback-list";

describe("formatRow", () => {
  it("renders a compact block with the new marker and metadata", () => {
    const out = formatRow({
      id: "x",
      created_at: "2026-07-29T18:30:00.000Z",
      kind: "suggest-trek",
      message:
        "Name suggestion for Unnamed peak (d12-1-2-3-4--bengaluru) — this hill is called: Bilikal Betta",
      trek_name: "Bilikal Betta",
      place: "Kanakapura",
      email: "a@b.in",
      page_url: null,
      reviewed: false,
    });
    expect(out).toContain("2026-07-29 18:30");
    expect(out).toContain("• new");
    expect(out).toContain("trek: Bilikal Betta");
    expect(out).toContain("Bilikal Betta");
  });
});

describe("isNameSuggestion", () => {
  it("recognises spec-28 prefilled suggestions for detected pins", () => {
    expect(
      isNameSuggestion({ kind: "suggest-trek", message: "… (d12-2947-1901-246-99--bengaluru) …" }),
    ).toBe(true);
    expect(isNameSuggestion({ kind: "suggest-trek", message: "add Kumara Parvatha!" })).toBe(false);
    expect(isNameSuggestion({ kind: "feedback", message: "d12-1-1-1-1--x" })).toBe(false);
  });
});

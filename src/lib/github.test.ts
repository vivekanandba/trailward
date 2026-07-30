import { describe, it, expect } from "vitest";
import { nameSuggestionUrl, suggestTrekUrl, feedbackUrl, REPO_URL } from "./github";

describe("GitHub issue links (spec 29)", () => {
  it("prefills the name-suggestion form with pin id, coordinates, and title", () => {
    const url = nameSuggestionUrl({
      id: "d12-2947-1901-246-99--bengaluru",
      name: "Unnamed peak (~444 m)",
      lat: 12.778489,
      lng: 79.098301,
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${REPO_URL}/issues/new`);
    expect(u.searchParams.get("template")).toBe("name-suggestion.yml");
    expect(u.searchParams.get("pin-id")).toBe("d12-2947-1901-246-99--bengaluru");
    expect(u.searchParams.get("coordinates")).toBe("12.77849, 79.09830");
    expect(u.searchParams.get("title")).toBe("Name suggestion: Unnamed peak (~444 m)");
  });

  it("routes trek suggestions and feedback to their templates", () => {
    expect(new URL(suggestTrekUrl()).searchParams.get("template")).toBe("suggest-trek.yml");
    expect(new URL(feedbackUrl()).searchParams.get("template")).toBe("feedback.yml");
  });
});

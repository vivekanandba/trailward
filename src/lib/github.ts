/**
 * Feedback via GitHub Issues (spec 29). A static page cannot create issues
 * through the API (any token shipped in a public bundle is auto-revoked by
 * GitHub secret scanning), so the app opens `issues/new` with the structured
 * issue-form fields PREFILLED via query params — the submitter only has to
 * press "Submit new issue". A weekly Actions job then applies accepted name
 * suggestions to the data (scripts/apply-name-issues.ts).
 */
import type { Trek } from "./trek";

export const REPO_URL = "https://github.com/vivekanandba/trailward";

const NEW_ISSUE = `${REPO_URL}/issues/new`;

function issueUrl(template: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams({ template });
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  return `${NEW_ISSUE}?${q.toString()}`;
}

/** Prefilled "Name a hill" issue for a terrain-detected pin. */
export function nameSuggestionUrl(trek: Pick<Trek, "id" | "name" | "lat" | "lng">): string {
  return issueUrl("name-suggestion.yml", {
    title: `Name suggestion: ${trek.name}`,
    "pin-id": trek.id,
    coordinates: `${trek.lat.toFixed(5)}, ${trek.lng.toFixed(5)}`,
  });
}

/** Prefilled "Suggest a trek" issue. */
export function suggestTrekUrl(): string {
  return issueUrl("suggest-trek.yml", {});
}

/** Prefilled general feedback issue. */
export function feedbackUrl(): string {
  return issueUrl("feedback.yml", {});
}

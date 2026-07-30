# 29 — Feedback via GitHub Issues

> Supersedes both the Web3Forms email form (spec 07) and this spec's own first design (a Neon
> Postgres inbox, PR #42) — the Neon store was replaced **before ever being provisioned**, so no
> data existed to migrate. Rationale for the change: feedback should live in GitHub itself —
> visible, threaded, closeable — with **zero external services and zero secrets**.

## Purpose

Feedback — above all the spec-28 **name suggestions** for terrain-detected summits — must come
back to the maintainer as reviewable, actionable data. On GitHub that is literally what issues
are, and Actions' built-in `GITHUB_TOKEN` can read them, apply them, and close them.

## Mechanism

**A static page cannot create issues via the API** — any token shipped in a public bundle is
auto-revoked by GitHub secret scanning. So the app uses **prefilled issue links**: structured
issue forms (`.github/ISSUE_TEMPLATE/*.yml`) support per-field URL prefill, and `src/lib/github.ts`
(pure, tested) builds `issues/new?template=…&pin-id=…&coordinates=…&title=…` URLs. The submitter
reviews the prefilled form and presses "Submit new issue". Accepted trade-off: submitters need a
GitHub account (fine for a maintainer-centric project).

Three surfaces → three templates:

- TrekDetail "Know this hill's name?" → `name-suggestion.yml` (label `name-suggestion`; pin id +
  coordinates prefilled),
- empty-state "Suggest it" → `suggest-trek.yml`,
- header "Feedback" → `feedback.yml`.

## The apply cron ("picked up through GitHub itself")

`.github/workflows/apply-suggestions.yml` — Sundays 02:00 UTC (the day before the weekly data
refresh, so applied names ride the same deploy) + `workflow_dispatch`; permissions
`contents: write, issues: write`; runs **`npm run apply:names`** (`scripts/apply-name-issues.ts`):

1. Lists open `name-suggestion` issues (`gh api`, built-in token).
2. `parseNameIssueBody` (pure, tested) extracts `### Pin id` / `### Suggested name`;
   `validateSuggestion` (pure, tested) checks the pin exists in
   `scripts/detected/india-detected.json`, name 3–60 chars, not "Unnamed…".
3. Valid → recorded in committed **`scripts/detected/human-names.json`**, renamed in the detected
   subset AND the baked `treks.json` (highlights: _"Named by the community via issue #N."_), the
   issue is closed with a thank-you. Invalid → a comment explaining what's missing +
   `needs-info` label, left open.
4. Commits as trailward-bot only when something changed (same pattern as `refresh-data.yml`).

**Durability**: `toDetectedTreks` applies `human-names.json` on every pipeline regeneration —
community names always outrank the summit file — and `build:names` never overwrites a name that
no longer starts with "Unnamed". If the repo is the only place the data lives, the repo is also
where the names live: nothing external to back up (deliberately NOT the resumefit-style
migrations/backup stack — there is no system-of-record database here at all any more).

## Verification

Unit: issue-URL building (template routing, prefill params, encoding), issue-body parsing
(well-formed, missing/blank fields, junk), suggestion validation (unknown pin, malformed id, bad
name), human-name override in `toDetectedTreks`, the two link surfaces in component tests.
Live: file a test issue via the app's prefilled link, run the workflow via `workflow_dispatch`,
confirm the commit + issue closure.

# 07 — Feedback & Suggest-a-Trek

## Purpose

Let friends/visitors send feedback or suggest a trek directly from the site, with **no backend**,
landing in the maintainer's email.

## User stories

- As a **friend testing the site**, I want to send a quick note or report a problem.
- As a **local trekker**, I want to suggest a trek that's missing.
- As the **maintainer**, I want submissions in my inbox without running a server.

## Acceptance criteria

- **Given** the feedback form, **when** I submit a message (+ optional email), **then** it POSTs to
  Web3Forms and I see a success confirmation.
- **Given** a "Suggest a trek" mode, **when** I submit a trek name + optional location/notes,
  **then** it is sent through the same form with a category field distinguishing it.
- **Given** a network/Web3Forms error, **when** submit fails, **then** I see a clear error and can
  retry; my input is not lost.
- **Given** empty/invalid input, **when** I try to submit, **then** validation blocks it with a
  helpful message (message required; email, if given, must look valid).
- **Given** no `VITE_WEB3FORMS_KEY` configured, **when** the form mounts in dev, **then** it shows
  a setup hint instead of silently failing.

## Interfaces & data contracts

```ts
// src/components/FeedbackForm.tsx
type FeedbackKind = "feedback" | "suggest-trek";
interface FeedbackPayload {
  kind: FeedbackKind;
  message: string;
  email?: string;
  trekName?: string; // suggest-trek
  place?: string; // suggest-trek
}
// src/lib/feedback.ts
submitFeedback(p: FeedbackPayload): Promise<{ ok: boolean; error?: string }>;
```

- POSTs JSON to `https://api.web3forms.com/submit` with `access_key` from `VITE_WEB3FORMS_KEY`,
  plus a `subject`/`from_name` derived from `kind`. Honeypot field for spam.
- CORS-friendly; works on GitHub Pages with no proxy.

## Edge cases & error states

- Spam honeypot filled → silently drop (pretend success), don't email.
- Double-submit → disable button while in flight.
- Very long message → soft cap with counter.

## Test cases (TDD checklist)

- Validation: empty message blocked; invalid email blocked; valid input enabled.
- `submitFeedback` success path (mocked fetch) returns `{ok:true}` and clears the form.
- Failure path (mocked 500/network) returns `{ok:false,error}` and preserves input.
- Suggest-trek mode includes `trekName`/`place` and the right category in the payload.
- Missing key → setup hint rendered; no POST attempted.

## Out of scope

- Storing/triaging feedback beyond email. Auth.

## Open questions

- Use the maintainer's real email + a Web3Forms key now, or a placeholder until you create one?
  (Default: placeholder + `.env.example`; you drop in the key.)

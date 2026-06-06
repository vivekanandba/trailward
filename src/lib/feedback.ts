// Backend-less feedback + suggest-a-trek via Web3Forms (spec 07). Submissions
// land in the maintainer's inbox; no server, CORS-friendly on GitHub Pages.
export type FeedbackKind = "feedback" | "suggest-trek";

export interface FeedbackPayload {
  kind: FeedbackKind;
  message: string;
  email?: string;
  trekName?: string; // suggest-trek
  place?: string; // suggest-trek
}

const WEB3FORMS_URL = "https://api.web3forms.com/submit";

// Pragmatic email shape check (not RFC-exhaustive): something@something.tld.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ValidationResult = { ok: true } | { ok: false; error: string };

/** Pure validation: message required; email, if given, must look valid. */
export function validateFeedback(p: FeedbackPayload): ValidationResult {
  if (!p.message.trim()) return { ok: false, error: "Please enter a message." };
  if (p.email && !EMAIL_RE.test(p.email)) {
    return { ok: false, error: "That email doesn't look valid." };
  }
  return { ok: true };
}

const SUBJECTS: Record<FeedbackKind, string> = {
  feedback: "Trailward feedback",
  "suggest-trek": "Trailward — suggested trek",
};

/**
 * Submit feedback. Validates first, requires VITE_WEB3FORMS_KEY (returns a
 * setup hint if absent), then POSTs JSON to Web3Forms. Never throws; surfaces
 * failures as { ok: false, error } so the form can show a retry and keep input.
 */
export async function submitFeedback(p: FeedbackPayload): Promise<{ ok: boolean; error?: string }> {
  const valid = validateFeedback(p);
  if (!valid.ok) return valid;

  const accessKey = import.meta.env.VITE_WEB3FORMS_KEY;
  if (!accessKey) {
    return { ok: false, error: "Feedback isn't configured — set VITE_WEB3FORMS_KEY." };
  }

  const body = {
    access_key: accessKey,
    subject: SUBJECTS[p.kind],
    from_name: "Trailward",
    category: p.kind,
    message: p.message,
    email: p.email,
    trekName: p.trekName,
    place: p.place,
  };

  try {
    const res = await fetch(WEB3FORMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Submission failed (${res.status}). Please retry.` };
    const json = (await res.json()) as { success?: boolean };
    if (!json.success) return { ok: false, error: "Submission was rejected. Please retry." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error. Please retry." };
  }
}

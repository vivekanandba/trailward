// Backend-less feedback + suggest-a-trek (specs 07/29). Primary sink is a Neon
// Postgres table written DIRECTLY from the browser over Neon's HTTP SQL
// endpoint: the bundled connection string belongs to an INSERT-only role
// (db/feedback-schema.sql), so the worst an abuser can do is spam rows — the
// same blast radius as any public form. Web3Forms (email) remains as fallback
// when configured. No server either way; CORS-friendly on GitHub Pages.
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

/** Is any submission sink configured? (Drives the form's setup hint.) */
export function feedbackConfigured(): boolean {
  return Boolean(import.meta.env.VITE_NEON_FEEDBACK_URL || import.meta.env.VITE_WEB3FORMS_KEY);
}

/**
 * Pure: build the HTTP request that inserts a feedback row through Neon's SQL
 * endpoint (the @neondatabase/serverless wire format — plain fetch, no driver:
 * POST https://<endpoint-host>/sql with the connection string as a header).
 * Throws on a malformed connection string so misconfiguration fails loudly.
 */
export function buildNeonRequest(
  connString: string,
  p: FeedbackPayload,
  pageUrl?: string,
): { url: string; headers: Record<string, string>; body: string } {
  const host = new URL(connString.replace(/^postgres(ql)?:/, "https:")).hostname;
  if (!host) throw new Error("empty Neon host");
  return {
    url: `https://${host}/sql`,
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": connString,
    },
    body: JSON.stringify({
      query:
        "INSERT INTO feedback (kind, message, trek_name, place, email, page_url) " +
        "VALUES ($1, $2, $3, $4, $5, $6)",
      params: [
        p.kind,
        p.message.slice(0, 4000),
        p.trekName?.slice(0, 200) ?? null,
        p.place?.slice(0, 200) ?? null,
        p.email?.slice(0, 200) ?? null,
        pageUrl?.slice(0, 500) ?? null,
      ],
    }),
  };
}

async function submitToNeon(
  connString: string,
  p: FeedbackPayload,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const req = buildNeonRequest(
      connString,
      p,
      typeof window !== "undefined" ? window.location.href : undefined,
    );
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
    if (!res.ok)
      return { ok: false, error: `Feedback store rejected the submission (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the feedback store. Check your connection." };
  }
}

/**
 * Submit feedback. Validates first. Prefers the Neon store (queryable — spec
 * 29); falls back to Web3Forms email when Neon is unconfigured or fails and a
 * key is present. Never throws; surfaces failures as { ok: false, error } so
 * the form can show a retry and keep input.
 */
export async function submitFeedback(p: FeedbackPayload): Promise<{ ok: boolean; error?: string }> {
  const valid = validateFeedback(p);
  if (!valid.ok) return valid;

  const neonUrl = import.meta.env.VITE_NEON_FEEDBACK_URL;
  const accessKey = import.meta.env.VITE_WEB3FORMS_KEY;
  if (!neonUrl && !accessKey) {
    return {
      ok: false,
      error: "Feedback isn't configured — set VITE_NEON_FEEDBACK_URL (see db/feedback-schema.sql).",
    };
  }

  if (neonUrl) {
    const neon = await submitToNeon(neonUrl, p);
    // Only fall through to email when a fallback actually exists.
    if (neon.ok || !accessKey) return neon;
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

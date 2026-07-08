import { useState } from "react";
import {
  submitFeedback,
  validateFeedback,
  type FeedbackKind,
  type FeedbackPayload,
} from "../lib/feedback";

interface FeedbackFormProps {
  onClose(): void;
  initialKind?: FeedbackKind;
  initialTrekName?: string;
}

const MESSAGE_MAX = 1000;

type Status = "idle" | "submitting" | "success" | "error";

export default function FeedbackForm({ onClose, initialKind, initialTrekName }: FeedbackFormProps) {
  // Web3Forms key read at render: absence means feedback can't be delivered, so
  // we show a setup hint instead of a dead submit (spec 07).
  const configured = Boolean(import.meta.env.VITE_WEB3FORMS_KEY);
  const [kind, setKind] = useState<FeedbackKind>(initialKind ?? "feedback");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [trekName, setTrekName] = useState(initialTrekName ?? "");
  const [place, setPlace] = useState("");
  const [honeypot, setHoneypot] = useState(""); // hidden; humans never fill it
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();

  const submitting = status === "submitting";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload: FeedbackPayload = {
      kind,
      message,
      email: email.trim() || undefined,
      trekName: kind === "suggest-trek" ? trekName.trim() || undefined : undefined,
      place: kind === "suggest-trek" ? place.trim() || undefined : undefined,
    };

    // Honeypot filled → a bot. Pretend success; never email or even validate,
    // so a bot gets no signal about why nothing happened (spec 07).
    if (honeypot.trim()) {
      setStatus("success");
      return;
    }

    // Validate up front so the user gets an inline message, not a failed POST.
    const valid = validateFeedback(payload);
    if (!valid.ok) {
      setStatus("error");
      setError(valid.error);
      return;
    }

    setStatus("submitting");
    setError(undefined);
    const res = await submitFeedback(payload);
    if (res.ok) {
      setStatus("success");
      setMessage("");
      setEmail("");
      setTrekName("");
      setPlace("");
    } else {
      // Preserve input so the user can retry without retyping.
      setStatus("error");
      setError(res.error);
    }
  };

  if (status === "success") {
    return (
      <div className="flex h-full flex-col">
        <Header onClose={onClose} title="Thanks!" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="text-3xl" aria-hidden>
            ✅
          </span>
          <p className="text-sm text-trail-700">
            Your {kind === "suggest-trek" ? "suggestion" : "feedback"} is on its way. Thank you!
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-trail-600 px-4 py-2 text-sm font-medium text-white hover:bg-trail-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header onClose={onClose} title="Get in touch" />

      {/* noValidate: we run validateFeedback ourselves and show our own
          messages; native constraint validation would otherwise block submit. */}
      <form
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
      >
        {/* Mode toggle */}
        <div className="flex gap-2" role="group" aria-label="Feedback type">
          {(["feedback", "suggest-trek"] as FeedbackKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition ${
                kind === k
                  ? "border-transparent bg-trail-600 text-white shadow-sm"
                  : "border-trail-200 bg-white text-trail-700 hover:border-trail-400"
              }`}
            >
              {k === "feedback" ? "Feedback" : "Suggest a trek"}
            </button>
          ))}
        </div>

        {!configured && (
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            Feedback isn't configured yet — set <code>VITE_WEB3FORMS_KEY</code> in your environment
            (see <code>.env.example</code>) to enable sending.
          </p>
        )}

        {kind === "suggest-trek" && (
          <>
            <Field label="Trek name">
              <input
                type="text"
                value={trekName}
                onChange={(e) => setTrekName(e.target.value)}
                placeholder="e.g. Kabbaladurga"
                className={inputClass}
              />
            </Field>
            <Field label="Location (optional)">
              <input
                type="text"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="Nearest town or area"
                className={inputClass}
              />
            </Field>
          </>
        )}

        <div>
          <Field label={kind === "suggest-trek" ? "Notes" : "Message"}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              rows={5}
              placeholder={
                kind === "suggest-trek"
                  ? "Why's this trek worth adding?"
                  : "Tell us what you think or report a problem…"
              }
              className={`${inputClass} resize-y`}
            />
          </Field>
          <span className="mt-1 block text-right text-xs tabular-nums text-trail-400">
            {message.length}/{MESSAGE_MAX}
          </span>
        </div>

        <Field label="Your email (optional)">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="So we can reply"
            className={inputClass}
          />
        </Field>

        {/* Honeypot: visually hidden, off the tab order; bots fill it, humans don't. */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="hidden"
        />

        {status === "error" && error && (
          <p role="alert" className="text-sm text-difficulty-hard">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !configured}
          className="rounded-lg bg-trail-600 py-2 text-sm font-medium text-white hover:bg-trail-700 disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-trail-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-trail-500 focus:outline-none focus:ring-2 focus:ring-trail-300";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-trail-800">{label}</span>
      {children}
    </label>
  );
}

function Header({ title, onClose }: { title: string; onClose(): void }) {
  return (
    <div className="flex items-center justify-between border-b border-trail-100 p-4">
      <h2 className="font-display text-xl font-semibold text-trail-900">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close feedback"
        className="rounded-md p-1 text-trail-500 hover:bg-trail-50"
      >
        ✕
      </button>
    </div>
  );
}

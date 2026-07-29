import { describe, it, expect, vi, afterEach } from "vitest";
import {
  submitFeedback,
  validateFeedback,
  buildNeonRequest,
  feedbackConfigured,
  type FeedbackPayload,
} from "./feedback";

const base: FeedbackPayload = { kind: "feedback", message: "Nice site!" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("validateFeedback (pure)", () => {
  it("blocks an empty message", () => {
    expect(validateFeedback({ ...base, message: "   " }).ok).toBe(false);
  });

  it("blocks an invalid email when provided", () => {
    expect(validateFeedback({ ...base, email: "not-an-email" }).ok).toBe(false);
  });

  it("accepts a valid message with no email", () => {
    expect(validateFeedback(base).ok).toBe(true);
  });

  it("accepts a valid message with a valid email", () => {
    expect(validateFeedback({ ...base, email: "a@b.co" }).ok).toBe(true);
  });
});

describe("submitFeedback", () => {
  it("returns a setup error and does not POST when nothing is configured", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "");
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await submitFeedback(base);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/VITE_NEON_FEEDBACK_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks invalid input before any POST", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await submitFeedback({ ...base, message: "" });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to Web3Forms with the access key and resolves ok on success", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const r = await submitFeedback(base);
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("api.web3forms.com");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.access_key).toBe("test-key");
    expect(body.message).toBe("Nice site!");
  });

  it("includes trekName/place and a category for suggest-trek", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await submitFeedback({
      kind: "suggest-trek",
      message: "Add this one",
      trekName: "Kabbaladurga",
      place: "Kanakapura",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.trekName).toBe("Kabbaladurga");
    expect(body.place).toBe("Kanakapura");
    expect(body.category).toBe("suggest-trek");
  });

  it("returns an error and preserves nothing extra on a failed POST", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const r = await submitFeedback(base);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("Neon feedback store (spec 29)", () => {
  const CONN =
    "postgres://trailward_writer:pw@ep-abc-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

  it("buildNeonRequest targets the endpoint's /sql with the conn string as header", () => {
    const req = buildNeonRequest(CONN, base, "https://x.github.io/?sel=d12-1");
    expect(req.url).toBe("https://ep-abc-123.ap-southeast-1.aws.neon.tech/sql");
    expect(req.headers["Neon-Connection-String"]).toBe(CONN);
    const body = JSON.parse(req.body);
    expect(body.query).toMatch(/INSERT INTO feedback/);
    expect(body.params[0]).toBe(base.kind);
    expect(body.params[1]).toBe(base.message);
    expect(body.params[5]).toBe("https://x.github.io/?sel=d12-1");
  });

  it("prefers Neon and does not touch Web3Forms on success", async () => {
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", CONN);
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
    const fetchMock = vi.fn(async (url: string) => {
      void url;
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await submitFeedback(base);
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("neon.tech");
  });

  it("falls back to Web3Forms when Neon fails and a key exists", async () => {
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", CONN);
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("neon.tech")
        ? new Response("nope", { status: 500 })
        : new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await submitFeedback(base);
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the Neon error when there is no fallback", async () => {
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", CONN);
    vi.stubEnv("VITE_WEB3FORMS_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const r = await submitFeedback(base);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/feedback store/i);
  });

  it("feedbackConfigured reflects either sink", () => {
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", "");
    vi.stubEnv("VITE_WEB3FORMS_KEY", "");
    expect(feedbackConfigured()).toBe(false);
    vi.stubEnv("VITE_NEON_FEEDBACK_URL", CONN);
    expect(feedbackConfigured()).toBe(true);
  });
});

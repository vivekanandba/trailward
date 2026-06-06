import { describe, it, expect, vi, afterEach } from "vitest";
import { submitFeedback, validateFeedback, type FeedbackPayload } from "./feedback";

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
  it("returns a setup error and does not POST when the key is missing", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await submitFeedback(base);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks invalid input before any POST", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await submitFeedback({ ...base, message: "" });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to Web3Forms with the access key and resolves ok on success", async () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const r = await submitFeedback(base);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackForm from "./FeedbackForm";

// Drive the component against a mocked submitFeedback so we assert on the
// payload + UI states without touching the network. validateFeedback stays
// real (it's pure) so inline validation is exercised end-to-end.
const submitFeedback = vi.fn();
vi.mock("../lib/feedback", async () => {
  const actual = await vi.importActual<typeof import("../lib/feedback")>("../lib/feedback");
  return { ...actual, submitFeedback: (...args: unknown[]) => submitFeedback(...args) };
});

afterEach(() => {
  cleanup();
  submitFeedback.mockReset();
  vi.unstubAllEnvs();
});

function configured() {
  vi.stubEnv("VITE_WEB3FORMS_KEY", "test-key");
}

describe("FeedbackForm", () => {
  it("blocks submit on an empty message and never POSTs", async () => {
    configured();
    const user = userEvent.setup();
    render(<FeedbackForm onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Please enter a message.")).toBeInTheDocument();
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("blocks submit on an invalid email", async () => {
    configured();
    const user = userEvent.setup();
    render(<FeedbackForm onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Message"), "Hello there");
    await user.type(screen.getByLabelText("Your email (optional)"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/email doesn't look valid/i)).toBeInTheDocument();
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("submits valid feedback and shows a success confirmation", async () => {
    configured();
    submitFeedback.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<FeedbackForm onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Message"), "Great site!");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(/on its way/i)).toBeInTheDocument());
    expect(submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "feedback", message: "Great site!" }),
    );
  });

  it("preserves input and shows an error when submit fails", async () => {
    configured();
    submitFeedback.mockResolvedValue({ ok: false, error: "Network error. Please retry." });
    const user = userEvent.setup();
    render(<FeedbackForm onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Message"), "Keep this");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network error/i));
    // input not lost
    expect(screen.getByLabelText("Message")).toHaveValue("Keep this");
  });

  it("sends trekName/place in suggest-trek mode", async () => {
    configured();
    submitFeedback.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<FeedbackForm onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Suggest a trek" }));
    await user.type(screen.getByLabelText("Trek name"), "Kabbaladurga");
    await user.type(screen.getByLabelText("Location (optional)"), "Kanakapura");
    await user.type(screen.getByLabelText("Notes"), "Worth adding");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(submitFeedback).toHaveBeenCalled());
    expect(submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "suggest-trek",
        trekName: "Kabbaladurga",
        place: "Kanakapura",
      }),
    );
  });

  it("shows a setup hint and disables Send when the key is missing", () => {
    vi.stubEnv("VITE_WEB3FORMS_KEY", "");
    render(<FeedbackForm onClose={vi.fn()} />);
    expect(screen.getByText(/isn't configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("drops bot submissions filling the honeypot without POSTing", async () => {
    configured();
    const user = userEvent.setup();
    const { container } = render(<FeedbackForm onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Message"), "real message");
    // Honeypot is hidden + aria-hidden; address it directly as a bot would.
    const honeypot = container.querySelector('input[tabindex="-1"]') as HTMLInputElement;
    await user.type(honeypot, "i-am-a-bot");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(/on its way/i)).toBeInTheDocument());
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("drops a honeypot bot even with an empty message (no validation error leaked)", async () => {
    configured();
    const user = userEvent.setup();
    const { container } = render(<FeedbackForm onClose={vi.fn()} />);
    // No message at all — a bot tripping the honeypot must still see fake success,
    // never the 'Please enter a message.' hint that would reveal the check (spec 07).
    const honeypot = container.querySelector('input[tabindex="-1"]') as HTMLInputElement;
    await user.type(honeypot, "i-am-a-bot");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(/on its way/i)).toBeInTheDocument());
    expect(screen.queryByText("Please enter a message.")).not.toBeInTheDocument();
    expect(submitFeedback).not.toHaveBeenCalled();
  });
});

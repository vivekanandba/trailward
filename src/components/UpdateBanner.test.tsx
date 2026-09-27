import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpdateBanner from "./UpdateBanner";

describe("UpdateBanner (spec 43 §B)", () => {
  it("shows nothing when no update is waiting", () => {
    // The common case by far. A banner that appears when there is no update
    // trains people to dismiss it unread.
    const { container } = render(<UpdateBanner onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the update politely — a status, not an alert", () => {
    render(<UpdateBanner onApply={() => {}} onDismiss={() => {}} />);
    // role=status is polite: a screen reader finishes its sentence first.
    // Nothing here is urgent enough to interrupt someone mid-route.
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/new version/i);
  });

  it("applies the update when Reload is pressed", async () => {
    const onApply = vi.fn();
    render(<UpdateBanner onApply={onApply} onDismiss={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("dismisses without applying when Later is pressed", async () => {
    // Declining must NOT swap the worker: the running page's lazily-loaded
    // chunks are pruned by the new worker's activate handler.
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    render(<UpdateBanner onApply={onApply} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

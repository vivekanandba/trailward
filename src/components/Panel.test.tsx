import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Panel from "./Panel";

afterEach(cleanup);

function renderPanel(onClose = vi.fn()) {
  render(
    <Panel onClose={onClose} labelledBy="t">
      <h2 id="t">Title</h2>
      <button>inside</button>
    </Panel>,
  );
  return onClose;
}

describe("Panel (accessible dialog)", () => {
  it("exposes modal dialog semantics by default", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "t");
  });

  it("non-modal variant keeps the dialog role but never claims aria-modal (spec 33)", () => {
    render(
      <Panel onClose={vi.fn()} labelledBy="nm" modal={false}>
        <h2 id="nm">Title</h2>
        <button>inside</button>
      </Panel>,
    );
    const dialog = screen.getByRole("dialog");
    // The desktop side panel deliberately leaves the map/list interactive —
    // claiming aria-modal there tells screen readers the page is gone.
    expect(dialog).not.toHaveAttribute("aria-modal");
  });

  it("focuses itself on open", () => {
    renderPanel();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onClose = renderPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

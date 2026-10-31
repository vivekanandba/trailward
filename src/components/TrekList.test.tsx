import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TrekList from "./TrekList";

const props = {
  treks: [],
  originName: "Bengaluru",
  onSelect: () => {},
  overflow: 0,
  empty: false,
  onClearFilters: () => {},
};

describe("TrekList loading state (spec 42 §E)", () => {
  it("marks the list busy while cells load, so the e2e suite can wait on state", () => {
    const { container, rerender } = render(<TrekList {...props} loading />);
    expect(container.querySelector("#results")?.getAttribute("aria-busy")).toBe("true");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Loading peaks near Bengaluru/);
    // aria-busy holds back announcements INSIDE the region, so the status must
    // sit outside it or it is never read.
    expect(status.closest("[aria-busy]")).toBeNull();
    rerender(<TrekList {...props} loading={false} />);
    // The live region outlives the load, so the NEXT load is a change to an
    // existing region — the only kind most screen readers announce.
    expect(screen.getByRole("status")).toHaveTextContent("");
    // The exact attribute value resultsLoaded() waits for.
    expect(container.querySelector("#results")?.getAttribute("aria-busy")).toBe("false");
  });
});

describe("TrekList empty state (spec 44 R11)", () => {
  it("offers a button that widens the radius, as the advice says", () => {
    const onWiden = vi.fn();
    render(<TrekList {...props} loading={false} empty widenTo={200} onWiden={onWiden} />);
    fireEvent.click(screen.getByRole("button", { name: "Widen to 200 km" }));
    expect(onWiden).toHaveBeenCalledWith(200);
  });

  it("offers no widening at the largest radius", () => {
    render(<TrekList {...props} loading={false} empty />);
    expect(screen.queryByRole("button", { name: /^Widen to/ })).not.toBeInTheDocument();
  });

  it("does not claim the radius is empty when part of it failed to load", () => {
    const onRetry = vi.fn();
    render(
      <TrekList
        {...props}
        loading={false}
        empty
        missingCells={2}
        widenTo={200}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText(/No treks match/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 parts of this area could not load/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
    // Widening would load MORE of what is failing; it is not offered here.
    expect(screen.queryByRole("button", { name: /^Widen to/ })).not.toBeInTheDocument();
  });
});

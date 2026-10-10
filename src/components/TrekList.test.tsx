import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

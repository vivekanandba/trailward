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
    expect(screen.getByRole("status")).toHaveTextContent(/Loading peaks near Bengaluru/);
    rerender(<TrekList {...props} loading={false} />);
    // The exact attribute value resultsLoaded() waits for.
    expect(container.querySelector("#results")?.getAttribute("aria-busy")).toBe("false");
  });
});

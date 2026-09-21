import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";

/**
 * The autoFocus opt-out (spec 42). Covered here because the defect it fixes
 * is invisible to a DOM-order test: App.a11y's "skip link first in tab order"
 * enumerates focusables and checks their ORDER, which passed throughout the
 * period when the mobile sheet stole focus on load and put the skip link out
 * of reach entirely.
 */
function Surface({ autoFocus, children }: { autoFocus?: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, { trap: false, onClose: () => {}, autoFocus });
  return (
    <div ref={ref} tabIndex={-1} data-testid="surface">
      {children}
    </div>
  );
}

describe("useDialogFocus autoFocus (spec 33/42)", () => {
  it("takes focus on mount by default — a dialog the user opened", () => {
    const { getByTestId } = render(<Surface />);
    expect(document.activeElement).toBe(getByTestId("surface"));
  });

  it("does NOT take focus when autoFocus is false", () => {
    // The mobile results sheet is present from page load. Focusing it meant
    // tabbing forward started inside it and walked the whole header the skip
    // link exists to skip — measured at 14 stops without reaching it.
    const before = document.activeElement;
    const { getByTestId } = render(<Surface autoFocus={false} />);
    expect(document.activeElement).not.toBe(getByTestId("surface"));
    expect(document.activeElement).toBe(before);
  });

  it("does not steal focus back on unmount when it never took it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount, getByTestId } = render(<Surface autoFocus={false} />);
    // Something else takes focus while the surface is mounted.
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();

    expect(document.activeElement).toBe(other);
    void getByTestId("surface");
    unmount();
    // Restoring focus we never held would yank the caret out of wherever the
    // user actually is.
    expect(document.activeElement).toBe(other);

    opener.remove();
    other.remove();
  });

  it("DOES restore focus to the opener when it did take it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<Surface />);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

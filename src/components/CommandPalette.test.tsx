import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import CommandPalette from "./CommandPalette";
import type { IndexEntry } from "../lib/search";

afterEach(cleanup);

const INDEX: IndexEntry[] = [
  { id: "kumara", name: "Kumara Parvatha", lat: 12.66, lng: 75.6, score: 0.9 },
  { id: "skanda", name: "Skandagiri", lat: 13.5, lng: 77.69, score: 0.8 },
  { id: "nandi", name: "Nandi Hills", lat: 13.37, lng: 77.68, score: 0.7 },
];

function setup(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette
      open
      onClose={onClose}
      onChoose={onChoose}
      loadIndex={async () => INDEX}
      {...overrides}
    />,
  );
  return { onChoose, onClose, ...utils };
}

describe("CommandPalette (spec 38)", () => {
  it("renders nothing when closed — no DOM cost, no behaviour to go wrong", () => {
    const { container } = render(
      <CommandPalette
        open={false}
        onClose={vi.fn()}
        onChoose={vi.fn()}
        loadIndex={async () => []}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes a labelled modal dialog with a combobox", async () => {
    setup();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("searches the index and shows matches", async () => {
    setup();
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "kumara" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Kumara Parvatha/ })).toBeVisible(),
    );
    expect(screen.queryByRole("option", { name: /Nandi/ })).toBeNull();
  });

  it("moves the active row with the arrow keys and chooses with Enter", async () => {
    const { onChoose } = setup();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "i" } }); // matches several
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));

    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true"),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const { onClose } = setup();
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says so when the index cannot be loaded, instead of looking broken", async () => {
    setup({ loadIndex: async () => Promise.reject(new Error("offline")) });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "kumara" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i));
  });

  it("offers a concrete suggestion when nothing matches", async () => {
    setup();
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "zzzzz" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/nothing matches/i));
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FilterBar from "./FilterBar";
import { DEFAULT_FILTERS, type FilterState } from "../lib/filters";

// Render a controlled FilterBar; onChange captures each pushed filter state,
// mirroring how App owns the state.
function setup(initial: FilterState = DEFAULT_FILTERS) {
  const onChange = vi.fn();
  const utils = render(<FilterBar filters={initial} onChange={onChange} resultCount={3} />);
  return { onChange, ...utils };
}

// userEvent doesn't drive <input type=range> in jsdom; fire a native change.
function fireChange(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

describe("FilterBar", () => {
  it("toggles a type chip into filters.types", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("button", { name: "Fort" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ types: ["Fort"] }));
  });

  it("removes a type when its chip is toggled off", async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ ...DEFAULT_FILTERS, types: ["Fort"] });
    await user.click(screen.getByRole("button", { name: "Fort" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ types: [] }));
  });

  it("sets filters.elevation when the minimum elevation changes", () => {
    const { onChange } = setup();
    fireChange(screen.getByLabelText("Minimum elevation in metres"), "500");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ elevation: [500, 2000] }));
  });

  it("clears filters.elevation when the range returns to full", () => {
    const { onChange } = setup({ ...DEFAULT_FILTERS, elevation: [500, 2000] });
    fireChange(screen.getByLabelText("Minimum elevation in metres"), "0");
    const next = onChange.mock.calls.at(-1)![0] as FilterState;
    expect(next.elevation).toBeUndefined();
  });

  it("sets trailLengthMaxKm from the trail-length slider", () => {
    const { onChange } = setup();
    fireChange(screen.getByLabelText("Maximum trail length in kilometres"), "8");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ trailLengthMaxKm: 8 }));
  });

  it("clears trailLengthMaxKm at the slider maximum (Any)", () => {
    const { onChange } = setup({ ...DEFAULT_FILTERS, trailLengthMaxKm: 8 });
    fireChange(screen.getByLabelText("Maximum trail length in kilometres"), "30");
    const next = onChange.mock.calls.at(-1)![0] as FilterState;
    expect(next.trailLengthMaxKm).toBeUndefined();
  });

  it("sets durationMaxHrs from the duration slider", () => {
    const { onChange } = setup();
    fireChange(screen.getByLabelText("Maximum duration in hours"), "4");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ durationMaxHrs: 4 }));
  });

  it("hides the trail-length and duration sliders when no trek carries those fields", () => {
    render(
      <FilterBar
        filters={DEFAULT_FILTERS}
        onChange={vi.fn()}
        resultCount={3}
        showTrailLength={false}
        showDuration={false}
      />,
    );
    expect(screen.queryByLabelText("Maximum trail length in kilometres")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum duration in hours")).not.toBeInTheDocument();
  });

  it("cycles the permit control any → required on first click", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("button", { name: /permit/i }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ permitRequired: true }));
  });

  it("disables Reset at defaults and enables it once a new filter is active", () => {
    const { rerender } = setup();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    rerender(
      <FilterBar
        filters={{ ...DEFAULT_FILTERS, types: ["Fort"] }}
        onChange={vi.fn()}
        resultCount={1}
      />,
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("resets to DEFAULT_FILTERS", async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ ...DEFAULT_FILTERS, types: ["Fort"], trailLengthMaxKm: 5 });
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });
});

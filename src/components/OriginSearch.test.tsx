import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import OriginSearch from "./OriginSearch";

// Geocoding is network I/O; the component's debounce, listbox and keyboard
// navigation are what these tests are about.
const geo = vi.hoisted(() => ({ results: [] as { name: string; lat: number; lng: number }[] }));
vi.mock("../lib/geocode", () => ({ geocode: async () => geo.results }));
import type { Origin } from "../lib/trek";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const origin: Origin = { id: "bangalore", name: "Bengaluru", lat: 12.97, lng: 77.59 };

function stubGeolocation(impl: Partial<Geolocation>) {
  vi.stubGlobal("navigator", { ...navigator, geolocation: impl as Geolocation });
}

describe("OriginSearch — use my location", () => {
  it("sets a 'My location' origin from a successful fix", async () => {
    stubGeolocation({
      getCurrentPosition: (success) =>
        (success as PositionCallback)({
          coords: { latitude: 15.85, longitude: 74.5 },
        } as GeolocationPosition),
    });
    const onPick = vi.fn();
    render(<OriginSearch origin={origin} onPick={onPick} />);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    // The flow is async (shared locateMe promise, spec 34) — await the pick.
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({ name: "My location", lat: 15.85, lng: 74.5 }),
      ),
    );
    expect(onPick.mock.calls[0][0].id).toMatch(/^geo:15\.85\d*,74\.5/);
  });

  it("shows an inline error when the location can't be obtained", async () => {
    stubGeolocation({
      getCurrentPosition: (_success, error) =>
        (error as PositionErrorCallback)?.({} as GeolocationPositionError),
    });
    const onPick = vi.fn();
    render(<OriginSearch origin={origin} onPick={onPick} />);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(onPick).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't get/i));
  });

  it("errors gracefully when geolocation is unsupported", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: undefined });
    render(<OriginSearch origin={origin} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/available/i));
  });
});

describe("OriginSearch — geocode results and keyboard navigation (spec 03)", () => {
  const RESULTS = [
    { name: "Manali, Himachal Pradesh", lat: 32.2432, lng: 77.1892 },
    { name: "Mandi, Himachal Pradesh", lat: 31.7084, lng: 76.9319 },
  ];

  async function typeAndWait(value: string) {
    geo.results = RESULTS;
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value } });
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2), { timeout: 3000 });
    return input;
  }

  it("lists geocode results as options once the debounce elapses", async () => {
    render(<OriginSearch origin={origin} onPick={vi.fn()} />);
    const input = screen.getByRole("combobox");
    geo.results = RESULTS;
    fireEvent.change(input, { target: { value: "manali" } });
    // Nothing immediately — Nominatim policy requires a gap between calls.
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2), { timeout: 3000 });
  });

  it("does not search for a fragment shorter than three characters", async () => {
    render(<OriginSearch origin={origin} onPick={vi.fn()} />);
    geo.results = RESULTS;
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ma" } });
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("arrow keys move the highlight and Enter picks the highlighted place", async () => {
    const onPick = vi.fn();
    render(<OriginSearch origin={origin} onPick={onPick} />);
    const input = await typeAndWait("man");

    fireEvent.keyDown(input, { key: "ArrowDown" }); // first
    fireEvent.keyDown(input, { key: "ArrowDown" }); // second
    fireEvent.keyDown(input, { key: "ArrowUp" }); // back to first
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Manali, Himachal Pradesh" }),
    );
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("Escape closes the listbox without picking anything", async () => {
    const onPick = vi.fn();
    render(<OriginSearch origin={origin} onPick={onPick} />);
    const input = await typeAndWait("man");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    expect(onPick).not.toHaveBeenCalled();
  });
});

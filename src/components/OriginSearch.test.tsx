import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import OriginSearch from "./OriginSearch";
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

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My location", lat: 15.85, lng: 74.5 }),
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

  it("errors gracefully when geolocation is unsupported", () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: undefined });
    render(<OriginSearch origin={origin} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/available/i);
  });
});

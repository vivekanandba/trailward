import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// Leaflet needs a real browser layout engine; stub the map in jsdom so the
// rest of the app shell can be unit-tested. Real map behaviour is covered e2e.
vi.mock("./components/TrekMap", () => ({
  default: () => <div data-testid="trek-map" />,
}));

beforeEach(() => {
  localStorage.clear();
});

describe("App", () => {
  it("renders the Trailward heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Trailward" })).toBeInTheDocument();
  });

  it("shows curated Bangalore treks in the list by default", () => {
    render(<App />);
    expect(screen.getByText("Skandagiri")).toBeInTheDocument();
    expect(screen.getByText("Nandi Hills")).toBeInTheDocument();
  });

  it("renders the filter controls and a reset action", () => {
    render(<App />);
    expect(screen.getByLabelText("Search radius in kilometres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });
});

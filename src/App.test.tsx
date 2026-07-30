import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// Leaflet needs a real browser layout engine; stub the map in jsdom so the
// rest of the app shell can be unit-tested. Real map behaviour is covered e2e.
vi.mock("./components/TrekMap", () => ({
  default: () => <div data-testid="trek-map" />,
}));

// The real dataset is a ~22 MB lazily-imported chunk (spec 27) — far too slow
// to transform in jsdom. Mock it with two curated records; the loading flow
// (dynamic import → state) still runs for real.
vi.mock("./data/treks.json", () => ({
  default: [
    {
      id: "skandagiri",
      name: "Skandagiri",
      lat: 13.5021,
      lng: 77.6911,
      cityId: "bangalore",
      tier: "curated",
      difficulty: "Moderate",
      sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
      verified: true,
    },
    {
      id: "nandi-hills",
      name: "Nandi Hills",
      lat: 13.3702,
      lng: 77.6835,
      cityId: "bangalore",
      tier: "curated",
      difficulty: "Easy",
      sources: ["https://en.wikipedia.org/wiki/Nandi_Hills,_Karnataka"],
      verified: true,
    },
  ],
}));

beforeEach(() => {
  localStorage.clear();
});

describe("App", () => {
  it("renders the Trailward heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Trailward" })).toBeInTheDocument();
  });

  it("shows curated Bangalore treks in the list by default", async () => {
    render(<App />);
    expect(await screen.findByText("Skandagiri")).toBeInTheDocument();
    expect(screen.getByText("Nandi Hills")).toBeInTheDocument();
  });

  it("renders the filter controls and a reset action", () => {
    render(<App />);
    expect(screen.getByLabelText("Search radius in kilometres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });
});

describe("App feedback surfaces (spec 29)", () => {
  it("the header Feedback control is a prefilled GitHub issue link", () => {
    render(<App />);
    const link = screen.getByRole("link", { name: "Feedback" });
    const u = new URL(link.getAttribute("href")!);
    expect(u.pathname.endsWith("/issues/new")).toBe(true);
    expect(u.searchParams.get("template")).toBe("feedback.yml");
  });
});

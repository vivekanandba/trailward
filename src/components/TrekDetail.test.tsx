import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TrekDetail from "./TrekDetail";
import type { Origin, Trek } from "../lib/trek";

// Weather is a network call; stub it so the detail panel renders offline.
vi.mock("../lib/weather", async () => {
  const actual = await vi.importActual<typeof import("../lib/weather")>("../lib/weather");
  return { ...actual, getWeather: () => Promise.resolve(null) };
});

// Lazy enrichment is a network call (spec 19); stub it so tests stay offline.
// vi.hoisted so the mock factory can reference it despite hoisting.
const { liveEnrich } = vi.hoisted(() => ({ liveEnrich: vi.fn() }));
vi.mock("../lib/enrich", () => ({ fetchLiveEnrichment: liveEnrich }));

beforeEach(() => liveEnrich.mockReset().mockResolvedValue({}));
afterEach(cleanup);

const origin: Origin = { id: "bangalore", name: "Bengaluru", lat: 12.97, lng: 77.59 };

const baseTrek: Trek = {
  id: "skandagiri",
  name: "Skandagiri",
  lat: 13.5,
  lng: 77.69,
  cityId: "bangalore",
  tier: "curated",
  sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
  verified: true,
};

describe("TrekDetail image", () => {
  it("renders the hero image with a linked attribution when present", () => {
    const trek: Trek = {
      ...baseTrek,
      image: {
        url: "https://upload.wikimedia.org/wikipedia/commons/a/a8/Skandagiri.jpg",
        attribution: "Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Skandagiri.jpg",
      },
    };
    render(<TrekDetail trek={trek} origin={origin} onClose={vi.fn()} />);
    const img = screen.getByRole("img", { name: "Skandagiri" });
    expect(img).toHaveAttribute("src", trek.image!.url);
    const credit = screen.getByRole("link", { name: "source" });
    expect(credit).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File:Skandagiri.jpg",
    );
  });

  it("renders no image when the trek has none", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("hides the hero if the image fails to load", () => {
    const trek: Trek = {
      ...baseTrek,
      image: { url: "https://upload.wikimedia.org/broken.jpg", attribution: "Wikimedia Commons" },
    };
    render(<TrekDetail trek={trek} origin={origin} onClose={vi.fn()} />);
    const img = screen.getByRole("img", { name: "Skandagiri" });
    fireEvent.error(img);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("TrekDetail lazy enrichment (spec 19)", () => {
  const gnTrek: Trek = {
    id: "gn-123--bengaluru",
    name: "Some Listed Hill",
    lat: 13.4,
    lng: 77.7,
    cityId: "bangalore",
    tier: "discovery",
    reliefM: 300,
    discoveryScore: 0.8,
    estimatedDifficulty: "Moderate",
    sources: ["https://www.geonames.org/123"],
    verified: false,
  };

  it("fetches and shows a nearby photo, summary, and town for a bare discovery pin", async () => {
    liveEnrich.mockResolvedValueOnce({
      image: { url: "https://upload.wikimedia.org/live.jpg", attribution: "Wikimedia Commons" },
      highlights: "A quiet granite dome.",
      nearestTown: "Chikkaballapur",
    });
    render(<TrekDetail trek={gnTrek} origin={origin} onClose={vi.fn()} />);
    expect(await screen.findByText("A quiet granite dome.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Some Listed Hill" })).toHaveAttribute(
      "src",
      "https://upload.wikimedia.org/live.jpg",
    );
    expect(screen.getByText("Chikkaballapur")).toBeInTheDocument();
  });

  it("does not fetch enrichment for a curated trek", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(liveEnrich).not.toHaveBeenCalled();
  });
});

describe("TrekDetail trail + elevation profile", () => {
  it("shows trail length, gain, and an elevation-profile chart", () => {
    const trek: Trek = {
      ...baseTrek,
      trail: {
        coords: [
          [13.5, 77.69],
          [13.502, 77.692],
          [13.504, 77.694],
        ],
        lengthKm: 2.69,
        gainM: 572,
        profile: [700, 900, 1272],
      },
    };
    render(<TrekDetail trek={trek} origin={origin} onClose={vi.fn()} />);
    expect(screen.getByText("Trail length")).toBeInTheDocument();
    expect(screen.getByText("~2.69 km")).toBeInTheDocument();
    expect(screen.getByText("~572 m")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /elevation profile/i })).toBeInTheDocument();
  });

  it("renders no Trail section when the trek has no trail", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(screen.queryByText("Trail length")).not.toBeInTheDocument();
  });
});

describe("TrekDetail GPX export", () => {
  it("downloads a GPX file naming the trek", () => {
    const createURL = vi.fn<(b: Blob) => string>(() => "blob:gpx");
    const revokeURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createURL, revokeObjectURL: revokeURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <TrekDetail trek={{ ...baseTrek, elevationM: 1350 }} origin={origin} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "GPX" }));

    expect(createURL).toHaveBeenCalledOnce();
    const blob = createURL.mock.calls[0][0];
    expect(blob.type).toBe("application/gpx+xml");
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeURL).toHaveBeenCalledWith("blob:gpx");
    vi.unstubAllGlobals();
  });
});

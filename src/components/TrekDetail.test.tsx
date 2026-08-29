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
    // Scoped to the hero photo: the panel also contains chart graphics with
    // role="img" (elevation profile, rainfall), which are not photos.
    expect(screen.queryByRole("img", { name: baseTrek.name })).not.toBeInTheDocument();
  });

  it("hides the hero if the image fails to load", () => {
    const trek: Trek = {
      ...baseTrek,
      image: { url: "https://upload.wikimedia.org/broken.jpg", attribution: "Wikimedia Commons" },
    };
    render(<TrekDetail trek={trek} origin={origin} onClose={vi.fn()} />);
    const img = screen.getByRole("img", { name: "Skandagiri" });
    fireEvent.error(img);
    expect(screen.queryByRole("img", { name: "Skandagiri" })).not.toBeInTheDocument();
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

describe("TrekDetail historical note (spec 21) + hill features (spec 22)", () => {
  it("renders the note with its source, year, and a changed-since caveat", () => {
    const trek: Trek = {
      ...baseTrek,
      historicalNote: {
        text: "A conspicuous fortified hill, 4,024 feet high.",
        source: "Imperial Gazetteer of India",
        year: 1908,
        url: "https://archive.org/",
      },
    };
    render(<TrekDetail trek={trek} origin={origin} onClose={vi.fn()} />);
    expect(screen.getByText("Historical note")).toBeInTheDocument();
    expect(screen.getByText(/conspicuous fortified hill/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Imperial Gazetteer of India" })).toBeInTheDocument();
    expect(screen.getByText(/1908.*conditions have changed/s)).toBeInTheDocument();
  });

  it("shows the protected area fact and heritage chip (spec 24)", () => {
    render(
      <TrekDetail
        trek={{
          ...baseTrek,
          protectedArea: "BRT Wildlife Sanctuary",
          heritage: "Monument of National Importance",
        }}
        origin={origin}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Protected area")).toBeInTheDocument();
    expect(screen.getByText("BRT Wildlife Sanctuary")).toBeInTheDocument();
    expect(screen.getByText("Monument of National Importance")).toBeInTheDocument();
  });

  it("shows alternate names (spec 25)", () => {
    render(
      <TrekDetail
        trek={{ ...baseTrek, altNames: ["Conollys Hill"] }}
        origin={origin}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Also known as Conollys Hill/)).toBeInTheDocument();
  });

  it("shows summit features as chips", () => {
    render(
      <TrekDetail
        trek={{ ...baseTrek, hillFeatures: ["fort", "temple"] }}
        origin={origin}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Fort")).toBeInTheDocument();
    expect(screen.getByText("Temple")).toBeInTheDocument();
  });

  it("renders neither section when the data is absent", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(screen.queryByText("Historical note")).not.toBeInTheDocument();
    expect(screen.queryByText("Fort")).not.toBeInTheDocument();
  });
});

describe("TrekDetail wildlife (spec 23)", () => {
  const gnTrek: Trek = {
    id: "gn-9--bengaluru",
    name: "Bare Hill",
    lat: 13.4,
    lng: 77.7,
    cityId: "bangalore",
    tier: "discovery",
    sources: ["https://www.geonames.org/9"],
    verified: false,
  };

  it("lists species fetched live, with the records count and a caveat", async () => {
    liveEnrich.mockResolvedValueOnce({
      wildlife: {
        records: 29484,
        species: [
          { name: "Bonnet Macaque", photo: "https://inat/sq.jpg" },
          { name: "Lepus nigricollis" },
        ],
      },
    });
    render(<TrekDetail trek={gnTrek} origin={origin} onClose={vi.fn()} />);
    expect(await screen.findByText("Wildlife nearby")).toBeInTheDocument();
    expect(screen.getByText("Bonnet Macaque")).toBeInTheDocument();
    expect(screen.getByText("Lepus nigricollis")).toBeInTheDocument();
    expect(screen.getByText("29,484 observations")).toBeInTheDocument();
    expect(screen.getByText(/not a sighting guarantee/)).toBeInTheDocument();
  });
});

describe("TrekDetail naming actions for detected pins (spec 28)", () => {
  const detTrek: Trek = {
    id: "d12-1-2-3-4--bengaluru",
    name: "Unnamed peak (~782 m)",
    lat: 16.72814,
    lng: 77.99772,
    cityId: "bangalore",
    tier: "discovery",
    detected: true,
    sources: ["https://opentopomap.org/#map=15/16.72814/77.99772"],
    verified: false,
  };

  it("shows the Google Maps lookup link and the prefilled GitHub issue link", () => {
    render(<TrekDetail trek={detTrek} origin={origin} onClose={vi.fn()} />);
    const lookup = screen.getByRole("link", { name: /look up on google maps/i });
    expect(lookup).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=16.72814,77.99772",
    );
    // The suggest link opens a GitHub issue form with the pin prefilled (spec 29).
    const suggest = screen.getByRole("link", { name: /know this hill's name/i });
    const u = new URL(suggest.getAttribute("href")!);
    expect(u.pathname.endsWith("/issues/new")).toBe(true);
    expect(u.searchParams.get("template")).toBe("name-suggestion.yml");
    expect(u.searchParams.get("pin-id")).toBe("d12-1-2-3-4--bengaluru");
    expect(u.searchParams.get("coordinates")).toBe("16.72814, 77.99772");
    expect(screen.getByText(/terrain-detected · unverified/)).toBeInTheDocument();
  });

  it("shows neither action for ordinary (named-source) pins", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /look up on google maps/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /know this hill's name/i })).not.toBeInTheDocument();
  });
});

describe("TrekDetail rainfall profile (spec 20)", () => {
  // baseTrek sits at 13.5/77.69 → a climate cell we sampled, so the panel renders
  // from the committed climate.json.
  it("shows the rainfall chart and wettest month for a covered coordinate", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(screen.getByText("Rainfall")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /mean monthly rainfall/i })).toBeInTheDocument();
    expect(screen.getByText(/wettest Jul/i)).toBeInTheDocument();
  });

  it("omits the rainfall panel where no climate cell was sampled", () => {
    // Mid-ocean: no peaks there, so no cell.
    render(
      <TrekDetail trek={{ ...baseTrek, lat: 0, lng: -30 }} origin={origin} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("Rainfall")).not.toBeInTheDocument();
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
    // Revocation is DEFERRED (spec 33): revoking synchronously after click()
    // races the browser's blob fetch and intermittently aborts the download.
    expect(revokeURL).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

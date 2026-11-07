import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import TrekDetail from "./TrekDetail";
import { sunTimes } from "../lib/sun";
import { sunSentence } from "../lib/voice";
import { DEFAULT_ORIGIN, type Origin, type Trek } from "../lib/trek";

const sunSentenceFor = (lat: number, lng: number, y: number, m: number, d: number) =>
  sunSentence(sunTimes(lat, lng, y, m, d));

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

  it("invites a name right under the title of an unnamed summit (spec 44 R13)", () => {
    render(<TrekDetail trek={detTrek} origin={origin} onClose={vi.fn()} />);
    const invite = screen.getByRole("link", { name: "Name this summit" });
    expect(invite.getAttribute("href")).toBe(
      screen.getByRole("link", { name: /know this hill's name/i }).getAttribute("href"),
    );
    expect(
      screen.getByText(/No one has given this summit a name we know of yet/),
    ).toBeInTheDocument();
  });

  it("invites a name for every unnamed form, not only terrain-detected pins", () => {
    for (const name of ["Unnamed hill (~640 m)", "Unnamed Peak"]) {
      const { unmount } = render(
        <TrekDetail
          trek={{ ...baseTrek, name, tier: "discovery" }}
          origin={origin}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByRole("link", { name: "Name this summit" })).toBeInTheDocument();
      unmount();
    }
  });

  it("shows neither action for ordinary (named-source) pins", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /look up on google maps/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /know this hill's name/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Name this summit" })).not.toBeInTheDocument();
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

describe("TrekDetail distance (spec 05; spec 44 register row 16)", () => {
  const measured: Trek = { ...baseTrek, distanceKm: 67.6, driveTimeMin: 76 };

  it("says 'by road' with the drive time from the origin it was measured from", () => {
    render(<TrekDetail trek={measured} origin={DEFAULT_ORIGIN} onClose={vi.fn()} />);
    expect(screen.getByText("~68 km by road · 1 h 16 min drive")).toBeInTheDocument();
  });

  it("says 'in a straight line', with no drive time, from anywhere else", () => {
    const mysuru: Origin = { id: "mysuru", name: "Mysuru", lat: 12.2958, lng: 76.6394 };
    render(<TrekDetail trek={measured} origin={mysuru} onClose={vi.fn()} />);
    expect(screen.getByText(/^~1\d\d km in a straight line$/)).toBeInTheDocument();
    expect(screen.queryByText(/drive/)).not.toBeInTheDocument();
  });
});

describe("TrekDetail prints as a field card (spec 44 R5)", () => {
  it("marks itself as the card and carries a print-only block with the essentials", () => {
    const { container } = render(
      <TrekDetail
        trek={{ ...baseTrek, lat: 13.4192, lng: 77.6836 }}
        origin={origin}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-print="card"]')).not.toBeNull();
    const block = container.querySelector('[data-testid="print-card"]')!;
    expect(block.className).toMatch(/\bhidden\b/);
    expect(block.className).toMatch(/\bprint:block\b/);
    expect(block.textContent).toContain("13°25′09″N 77°41′01″E");
    expect(block.textContent).toContain(
      "https://www.google.com/maps/dir/?api=1&destination=13.4192%2C77.6836",
    );
    expect(block.textContent).toMatch(/Printed from Trailward on \d{1,2} \w{3} \d{4}/);
  });

  it("keeps the action buttons off paper", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    const directions = screen.getByRole("link", { name: "Directions" });
    expect(directions.closest('[data-print="hide"]')).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /close/i }).closest('[data-print="hide"]'),
    ).not.toBeNull();
  });

  it("updates the printed date when the browser is about to print", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-31T06:00:00Z"));
      render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
      expect(screen.getByTestId("print-card").textContent).toContain("31 Oct 2026");
      vi.setSystemTime(new Date("2026-11-02T06:00:00Z"));
      act(() => {
        window.dispatchEvent(new Event("beforeprint"));
      });
      expect(screen.getByTestId("print-card").textContent).toContain("2 Nov 2026");
    } finally {
      vi.useRealTimers(); // even when an assertion fails (CON-VER-008)
    }
  });
});

describe("TrekDetail sun and season (spec 44 R6, R7)", () => {
  afterEach(() => vi.useRealTimers());

  it("gives today's sunrise and sunset in a sentence, and the same in the drawing's label", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T03:00:00Z")); // 08:30 IST
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    const sentence = screen.getByText(
      /^Sunrise \d\d:\d\d and sunset \d\d:\d\d today \(IST\); the sun comes up in the (north|east)/,
    );
    const drawing = screen.getByRole("img", { name: sentence.textContent! });
    expect(drawing.tagName.toLowerCase()).toBe("svg");
  });

  it("uses India's date, not the device's UTC date, near midnight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:00 UTC on 20 Jun is 04:30 IST on 21 Jun: the sun of the 21st.
    vi.setSystemTime(new Date("2026-06-20T23:00:00Z"));
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    const june21 = sunSentenceFor(baseTrek.lat, baseTrek.lng, 2026, 6, 21);
    expect(screen.getByText(june21)).toBeInTheDocument();
  });

  it("marks this month on the rainfall chart and says what it means here", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T06:00:00Z"));
    const { container } = render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(container.querySelector('[data-month-now="0"]')).not.toBeNull();
    expect(screen.getByText(/^Now is the drier stretch here/)).toBeInTheDocument();
  });

  it("says nothing about the season where no cell was sampled", () => {
    render(
      <TrekDetail trek={{ ...baseTrek, lat: 0, lng: -30 }} origin={origin} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/^Now is/)).not.toBeInTheDocument();
  });
});

describe("TrekDetail been there (spec 44 R16)", () => {
  it("offers a toggle that is off for a peak not yet ticked", () => {
    render(
      <TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} onToggleClimbed={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Been there" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("does not carry a celebration over to the next peak the panel shows", () => {
    // The panel is reused across selections; the toggle must not be.
    const onToggle = vi.fn(() => true);
    const { rerender } = render(
      <TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} onToggleClimbed={onToggle} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Been there" }));
    const other = { ...baseTrek, id: "other", name: "Other" };
    rerender(
      <TrekDetail
        trek={other}
        origin={origin}
        onClose={vi.fn()}
        onToggleClimbed={onToggle}
        climbedOn="2026-09-01"
      />,
    );
    expect(document.querySelector(".climbed-in")).toBeNull();
  });

  it("says when it was ticked, and celebrates only in answer to the press", () => {
    const onToggle = vi.fn(() => true);
    const { rerender } = render(
      <TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} onToggleClimbed={onToggle} />,
    );
    expect(document.querySelector(".climbed-in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Been there" }));
    expect(onToggle).toHaveBeenCalledWith(true);
    rerender(
      <TrekDetail
        trek={baseTrek}
        origin={origin}
        onClose={vi.fn()}
        onToggleClimbed={onToggle}
        climbedOn="2026-10-31"
      />,
    );
    expect(screen.getByRole("button", { name: "Been there" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Ticked on 31 Oct 2026, on this device.")).toBeInTheDocument();
    expect(document.querySelector(".climbed-in")).not.toBeNull();
  });

  it("does not celebrate a peak that was already ticked when the panel opened", () => {
    render(
      <TrekDetail
        trek={baseTrek}
        origin={origin}
        onClose={vi.fn()}
        onToggleClimbed={vi.fn()}
        climbedOn="2026-01-02"
      />,
    );
    expect(document.querySelector(".climbed-in")).toBeNull();
  });

  it("says so when the device would not keep it, instead of pretending", () => {
    render(
      <TrekDetail
        trek={baseTrek}
        origin={origin}
        onClose={vi.fn()}
        onToggleClimbed={() => false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Been there" }));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't save that on this device.");
  });

  it("offers no toggle where nothing can keep it", () => {
    render(<TrekDetail trek={baseTrek} origin={origin} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Been there" })).not.toBeInTheDocument();
  });
});

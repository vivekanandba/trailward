import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TrekDetail from "./TrekDetail";
import type { Origin, Trek } from "../lib/trek";

// Weather is a network call; stub it so the detail panel renders offline.
vi.mock("../lib/weather", async () => {
  const actual = await vi.importActual<typeof import("../lib/weather")>("../lib/weather");
  return { ...actual, getWeather: () => Promise.resolve(null) };
});

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

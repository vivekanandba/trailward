import { describe, it, expect } from "vitest";
import { renderTrekPage } from "./trekPage";
import type { Trek } from "../../src/lib/trek";

const full: Trek = {
  id: "skandagiri",
  name: "Skandagiri",
  lat: 13.5021,
  lng: 77.6911,
  tier: "curated",
  elevationM: 1350,
  difficulty: "Moderate",
  type: ["Hill", "Fort"],
  bestSeason: "Oct–Feb",
  nightTrek: true,
  highlights: "Famous pre-dawn trek to catch a sunrise above the clouds.",
  nearestTown: "Chikkaballapur",
  landCover: "Forest",
  reliefM: 318,
  meanSlopeDeg: 13.4,
  image: {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a8/Skandagiri.jpg",
    attribution: "Wikimedia Commons",
  },
  sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
  verified: true,
};

const html = () => renderTrekPage(full, "skandagiri");

describe("renderTrekPage (spec 35 — readable without JavaScript)", () => {
  it("puts the trek name in the title and a real h1, not injected by JS", () => {
    const out = html();
    expect(out).toContain("<title>Skandagiri");
    expect(out).toMatch(/<h1[^>]*>\s*Skandagiri/);
    expect(out).not.toContain('<script type="module"');
  });

  it("renders the facts the record carries", () => {
    const out = html();
    for (const fact of ["1350", "Moderate", "Oct–Feb", "Chikkaballapur", "Forest", "318"]) {
      expect(out).toContain(fact);
    }
  });

  it("links into the live map using the deep-link contract (spec 30/33)", () => {
    expect(html()).toContain('href="/trailward/?sel=skandagiri"');
  });

  it("carries an absolute canonical and og:url that agree", () => {
    const out = html();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(out)![1];
    const ogUrl = /<meta property="og:url" content="([^"]+)"/.exec(out)![1];
    expect(canonical).toBe("https://vivekanandba.github.io/trailward/t/skandagiri/");
    expect(ogUrl).toBe(canonical);
    expect(canonical).not.toContain("/trailward/trailward/");
  });

  it("embeds TouristAttraction JSON-LD with real coordinates", () => {
    const ld = JSON.parse(
      /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html())![1],
    ) as Record<string, never>;
    expect(ld["@type"]).toBe("TouristAttraction");
    expect((ld.geo as unknown as Record<string, number>).latitude).toBe(13.5021);
  });

  it("shows the photo WITH its required attribution, never bare", () => {
    const out = html();
    expect(out).toContain("Skandagiri.jpg");
    expect(out).toContain("Wikimedia Commons");
  });

  it("escapes HTML in user-facing strings — a name is untrusted input", () => {
    const evil: Trek = { ...full, name: 'Hill <img src=x onerror="alert(1)">' };
    const out = renderTrekPage(evil, "evil");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img");
  });

  it("omits sections for facts the record lacks, never printing undefined", () => {
    const bare: Trek = {
      id: "gn-1",
      name: "Bare Hill",
      lat: 12,
      lng: 77,
      tier: "discovery",
      sources: [],
      verified: false,
    };
    const out = renderTrekPage(bare, "bare-hill");
    expect(out).not.toMatch(/undefined|NaN|\[object/);
    expect(out).toContain("Bare Hill");
  });

  it("is valid-ish HTML: doctype, lang, viewport, single h1", () => {
    const out = html();
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain('<html lang="en">');
    expect(out).toContain("viewport");
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
  });
});

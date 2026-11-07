import { describe, it, expect } from "vitest";
import { routeFor, slugsFromSitemap, suggestionFor } from "./notFound";

// Spec 44 R10. GitHub Pages serves 404.html for any missing path. It used to
// send everything to the app root and drop the path, so a mistyped or retired
// trek URL landed on Bengaluru with no word about what happened.
describe("routeFor", () => {
  it("sends any non-trek path into the app, keeping query and hash", () => {
    expect(routeFor("/trailward/some/old/path", "?sel=x&r=50", "#map")).toEqual({
      kind: "redirect",
      to: "/trailward/?sel=x&r=50#map",
    });
    expect(routeFor("/trailward/", "", "")).toEqual({ kind: "redirect", to: "/trailward/" });
  });

  it("keeps a missing trek page here, to say so and offer what was meant", () => {
    expect(routeFor("/trailward/t/kumara-parvata/", "", "")).toEqual({
      kind: "trek",
      slug: "kumara-parvata",
    });
    expect(routeFor("/trailward/t/kumara-parvata", "", "")).toEqual({
      kind: "trek",
      slug: "kumara-parvata",
    });
  });

  it("does not treat a deeper path under /t/ as a slug", () => {
    expect(routeFor("/trailward/t/a/b/", "", "").kind).toBe("redirect");
  });
});

describe("slugsFromSitemap", () => {
  it("reads every trek slug, and nothing else", () => {
    const xml = `<urlset><url><loc>https://x/trailward/</loc></url>
      <url><loc>https://x/trailward/t/skandagiri/</loc></url>
      <url><loc>https://x/trailward/about/</loc></url>
      <url><loc>https://x/trailward/t/kumara-parvatha/</loc></url></urlset>`;
    expect(slugsFromSitemap(xml)).toEqual(["skandagiri", "kumara-parvatha"]);
  });
});

describe("suggestionFor", () => {
  it("offers the one confident match", () => {
    expect(suggestionFor("kumara-parvata", ["kumara-parvatha", "skandagiri"])).toBe(
      "kumara-parvatha",
    );
  });

  it("offers nothing on a tie or a guess", () => {
    expect(
      suggestionFor("nandi-hills-gn", ["nandi-hills-gn-1", "nandi-hills-gn-2"]),
    ).toBeUndefined();
    expect(suggestionFor("zzz", ["skandagiri"])).toBeUndefined();
  });
});

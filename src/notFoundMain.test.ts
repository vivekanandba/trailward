import { describe, it, expect, vi, beforeEach } from "vitest";

// The 404 page's wiring (spec 44 R10), against a missing trek URL.
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<p id="suggestion" role="status">It may have been mistyped.</p>';
});

const sitemap = `<urlset><url><loc>https://x/trailward/t/kumara-parvatha/</loc></url>
<url><loc>https://x/trailward/t/skandagiri/</loc></url></urlset>`;

describe("notFoundMain", () => {
  it("offers the confident match as a link", async () => {
    window.history.pushState({}, "", "/trailward/t/kumara-parvata/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sitemap)),
    );
    await import("./notFoundMain");
    await vi.waitFor(() => expect(document.querySelector("#suggestion a")).not.toBeNull());
    const a = document.querySelector<HTMLAnchorElement>("#suggestion a")!;
    expect(a.getAttribute("href")).toBe("/trailward/t/kumara-parvatha/");
    expect(document.getElementById("suggestion")!.textContent).toBe(
      "Did you mean /t/kumara-parvatha/?",
    );
  });

  it("leaves the honest message when the sitemap cannot be read", async () => {
    window.history.pushState({}, "", "/trailward/t/kumara-parvata/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await import("./notFoundMain");
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById("suggestion")!.textContent).toBe("It may have been mistyped.");
  });
});

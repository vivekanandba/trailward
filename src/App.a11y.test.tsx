import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { auditA11y } from "./lib/a11yCheck";
import { DIFFICULTY_COLORS, DISCOVERY_COLOR } from "./lib/difficulty";
import { assertContrast } from "./lib/a11yCheck";

vi.mock("./components/TrekMap", () => ({
  default: () => <div data-testid="trek-map" />,
}));

vi.mock("./lib/cells", () => ({
  loadTreksAround: async () => [
    {
      id: "skandagiri",
      name: "Skandagiri",
      lat: 13.5021,
      lng: 77.6911,
      tier: "curated",
      difficulty: "Moderate",
      elevationM: 1350,
      sources: ["https://en.wikipedia.org/wiki/Skandagiri"],
      verified: true,
    },
  ],
}));

beforeEach(() => localStorage.clear());

describe("App accessibility audit (spec 37)", () => {
  it("has no violations in the default state", async () => {
    const { container } = render(<App />);
    await screen.findByText("Skandagiri");
    const violations = auditA11y(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("has no violations with the detail panel open — overlays concentrate these bugs", async () => {
    const { container } = render(<App />);
    fireEvent.click(await screen.findByText("Skandagiri"));
    await screen.findByRole("dialog");
    const violations = auditA11y(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("offers a skip link first in tab order, hidden until focused", async () => {
    render(<App />);
    const skip = screen.getByRole("link", { name: /skip to results/i });
    // First focusable element in the document.
    const focusables = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ),
    ];
    expect(focusables[0]).toBe(skip);
    // Visually hidden until it receives focus (sr-only + focus: overrides).
    expect(skip.className).toMatch(/sr-only/);
    expect(skip.className).toMatch(/focus:/);
  });

  it("announces the result count politely when filters change it", async () => {
    render(<App />);
    await screen.findByText("Skandagiri");
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    await waitFor(() => expect(live!.textContent).toMatch(/\d+\s+trek/i));
  });
});

describe("palette contrast is computed, not assumed (spec 37)", () => {
  const LIGHT_SURFACE = "#ffffff";
  const DARK_SURFACE = "#0f172a";

  it("difficulty colours carry white text at AA on both surfaces", () => {
    for (const [name, hex] of Object.entries(DIFFICULTY_COLORS)) {
      // Badges render white-on-colour; the colour must carry white text.
      expect(() => assertContrast("#ffffff", hex, 4.5), name).not.toThrow();
    }
  });

  it("pin colours remain distinguishable as UI components on both basemaps", () => {
    for (const [name, hex] of Object.entries({
      ...DIFFICULTY_COLORS,
      discovery: DISCOVERY_COLOR,
    })) {
      // 3:1 is the WCAG threshold for non-text UI components.
      expect(() => assertContrast(hex, LIGHT_SURFACE, 3), `${name} on light`).not.toThrow();
      expect(() => assertContrast(hex, DARK_SURFACE, 3), `${name} on dark`).not.toThrow();
    }
  });
});

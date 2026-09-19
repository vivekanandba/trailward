import { describe, it, expect } from "vitest";
import { auditA11y, contrastRatio, assertContrast } from "./a11yCheck";

/** Build a detached DOM tree from HTML for the rule tests. */
function dom(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("auditA11y — accessible names (spec 37)", () => {
  it("flags a button with no accessible name", () => {
    const v = auditA11y(dom("<button></button>"));
    expect(v.map((x) => x.rule)).toContain("name");
  });

  it("accepts a name from text, aria-label, or aria-labelledby", () => {
    expect(auditA11y(dom("<button>Filters</button>"))).toEqual([]);
    expect(auditA11y(dom('<button aria-label="Close"></button>'))).toEqual([]);
    expect(
      auditA11y(dom('<span id="t">Close</span><button aria-labelledby="t"></button>')),
    ).toEqual([]);
  });

  it("flags a link with no discernible text", () => {
    expect(auditA11y(dom('<a href="/x"></a>')).map((x) => x.rule)).toContain("name");
  });
});

describe("auditA11y — images and controls", () => {
  it("flags an image with no alt attribute, but allows an empty decorative alt", () => {
    expect(auditA11y(dom('<img src="x.png">')).map((x) => x.rule)).toContain("alt");
    expect(auditA11y(dom('<img src="x.png" alt="">'))).toEqual([]);
  });

  it("flags an unlabelled form control", () => {
    expect(auditA11y(dom('<input type="search">')).map((x) => x.rule)).toContain("label");
    expect(auditA11y(dom('<label for="q">Q</label><input id="q">'))).toEqual([]);
    expect(auditA11y(dom('<input aria-label="Search treks">'))).toEqual([]);
  });
});

describe("auditA11y — document structure", () => {
  it("flags more than one h1", () => {
    expect(auditA11y(dom("<h1>a</h1><h1>b</h1>")).map((x) => x.rule)).toContain("one-h1");
  });

  it("flags a skipped heading level", () => {
    expect(auditA11y(dom("<h1>a</h1><h3>b</h3>")).map((x) => x.rule)).toContain("heading-order");
    expect(auditA11y(dom("<h1>a</h1><h2>b</h2><h3>c</h3>"))).toEqual([]);
  });

  it("flags a focusable element hidden from assistive tech", () => {
    const v = auditA11y(dom('<div aria-hidden="true"><button>Go</button></div>'));
    expect(v.map((x) => x.rule)).toContain("aria-hidden-focusable");
  });
});

describe("contrast (spec 37 — computed, never assumed)", () => {
  it("computes known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 2);
  });

  it("passes the brand ink on the brand surface and fails a deliberately bad pair", () => {
    // Proves the gate enforces rather than merely existing.
    expect(() => assertContrast("#1c3927", "#f0f7f1", 4.5)).not.toThrow();
    expect(() => assertContrast("#cccccc", "#ffffff", 4.5)).toThrow(/contrast/i);
  });
});

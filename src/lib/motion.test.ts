import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  noteUserActions,
  prefersReducedMotion,
  resetUserActionsForTest,
  shouldAnimate,
  userHasActed,
} from "./motion";

// Spec 44 D2 (every movement has a still version) and the rule against motion
// on page load with no action behind it (register row 6).
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: reduce && q.includes("reduce"), media: q })),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetUserActionsForTest();
});

describe("prefersReducedMotion", () => {
  it("reads the media query", () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("userHasActed", () => {
  it("is false until the first pointer press or key press, then true", () => {
    noteUserActions(window);
    expect(userHasActed()).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(userHasActed()).toBe(true);
  });

  it("counts a pointer press", () => {
    noteUserActions(window);
    window.dispatchEvent(new Event("pointerdown"));
    expect(userHasActed()).toBe(true);
  });

  it("does not count a scroll or a mouse move: nothing was asked for", () => {
    noteUserActions(window);
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("mousemove"));
    expect(userHasActed()).toBe(false);
  });
});

describe("shouldAnimate", () => {
  it("is false on load, before any action, even with motion allowed", () => {
    stubReducedMotion(false);
    noteUserActions(window);
    expect(shouldAnimate()).toBe(false);
  });

  it("is true after an action when motion is allowed", () => {
    stubReducedMotion(false);
    noteUserActions(window);
    window.dispatchEvent(new Event("pointerdown"));
    expect(shouldAnimate()).toBe(true);
  });

  it("is false under reduced motion, whatever the person did", () => {
    stubReducedMotion(true);
    noteUserActions(window);
    window.dispatchEvent(new Event("pointerdown"));
    expect(shouldAnimate()).toBe(false);
  });
});

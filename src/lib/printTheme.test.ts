import { describe, it, expect, afterEach } from "vitest";
import { printInLight } from "./theme";
import { toDms } from "./coords";

// Spec 44 R5: dark: variants follow the class, not the medium, so a dark page
// printed near-white text on white paper.
describe("printInLight", () => {
  const root = document.documentElement;
  let stop = () => {};
  afterEach(() => {
    stop();
    root.classList.remove("dark");
  });

  it("prints a dark page in the light theme and puts dark back after", () => {
    root.classList.add("dark");
    stop = printInLight();
    window.dispatchEvent(new Event("beforeprint"));
    expect(root.classList.contains("dark")).toBe(false);
    window.dispatchEvent(new Event("afterprint"));
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("leaves a light page light after printing", () => {
    stop = printInLight();
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("afterprint"));
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("stops listening when cleaned up", () => {
    root.classList.add("dark");
    printInLight()();
    window.dispatchEvent(new Event("beforeprint"));
    expect(root.classList.contains("dark")).toBe(true);
  });
});

describe("toDms hemisphere", () => {
  it("names the hemisphere of the rounded value: the equator is N", () => {
    expect(toDms(-0.0001, 0)).toBe("0°00′00″N 0°00′00″E");
    expect(toDms(-12.5, -0.0001)).toBe("12°30′00″S 0°00′00″E");
  });
});

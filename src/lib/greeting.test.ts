import { describe, it, expect, vi, beforeEach } from "vitest";
import { GREETING, greetOnce, resetGreetingForTest } from "./greeting";

// Spec 44 R15: the console is where a developer looks; it says where the code
// and data come from, once, and claims nothing it cannot back.
beforeEach(() => resetGreetingForTest());

describe("greeting", () => {
  it("names the source of the data and where the code lives", () => {
    expect(GREETING).toMatch(/open data/);
    expect(GREETING).toContain("https://github.com/vivekanandba/trailward");
    expect(GREETING).not.toMatch(/\d{2,}/); // no counts that could be out of date
  });

  it("is said once, however often the app mounts", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    greetOnce();
    greetOnce();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(GREETING);
    info.mockRestore();
  });
});

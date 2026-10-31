import { describe, it, expect, beforeEach, vi } from "vitest";
import { CLIMBED_KEY, loadClimbed, setClimbed } from "./climbed";

// Spec 44 R16 ("Been there", register row 19). Personal state on this device
// only: it must never break the app when storage is missing, full or corrupt.
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("climbed peaks", () => {
  it("is empty to begin with", () => {
    expect(loadClimbed().size).toBe(0);
  });

  it("remembers a ticked peak with the day it was ticked, and forgets an unticked one", () => {
    setClimbed("skandagiri", true, "2026-10-31");
    expect(loadClimbed().get("skandagiri")).toBe("2026-10-31");
    setClimbed("skandagiri", false);
    expect(loadClimbed().has("skandagiri")).toBe(false);
  });

  it("keeps the first day when a peak is ticked again", () => {
    setClimbed("skandagiri", true, "2026-10-01");
    setClimbed("skandagiri", true, "2026-10-31");
    expect(loadClimbed().get("skandagiri")).toBe("2026-10-01");
  });

  it("reads corrupt or foreign data as nothing climbed", () => {
    for (const raw of ["not json", "[1,2]", '{"a":5}', "null"]) {
      localStorage.setItem(CLIMBED_KEY, raw);
      expect(() => loadClimbed()).not.toThrow();
    }
    localStorage.setItem(CLIMBED_KEY, '{"a":"2026-01-01","b":5}');
    expect([...loadClimbed().keys()]).toEqual(["a"]);
  });

  it("never throws when storage itself throws (private mode, blocked, full)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadClimbed().size).toBe(0);
    expect(() => setClimbed("x", true, "2026-10-31")).not.toThrow();
  });

  it("reports whether the write was kept, so the UI never claims a save that did not happen", () => {
    expect(setClimbed("x", true, "2026-10-31")).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(setClimbed("y", true, "2026-10-31")).toBe(false);
  });
});

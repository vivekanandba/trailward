import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import OfflineNote from "./OfflineNote";

// Spec 44 R14: say when the app is offline, and promise only what spec 43's
// cache really holds (the shell, and data already fetched on this device).
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setOnline = (v: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(v);

describe("OfflineNote", () => {
  it("is absent online", () => {
    setOnline(true);
    render(<OfflineNote />);
    expect(screen.queryByRole("status")).toHaveTextContent("");
  });

  it("speaks when the app opens already offline: no `offline` event fires then", () => {
    setOnline(false);
    render(<OfflineNote />);
    expect(screen.getByRole("status")).toHaveTextContent(/You're offline/);
  });

  it("appears on going offline and clears on coming back", () => {
    setOnline(true);
    render(<OfflineNote />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/You're offline/);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("promises only what the cache holds", () => {
    setOnline(false);
    render(<OfflineNote />);
    const text = screen.getByRole("status").textContent!;
    expect(text).toMatch(/already opened on this device/);
    expect(text).toMatch(/needs a connection/);
    expect(text).not.toMatch(/everything|all of India|full/i);
  });
});

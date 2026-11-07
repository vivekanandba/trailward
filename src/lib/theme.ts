// Light/dark theme persistence + application (spec 08). The initial class is set
// by an inline script in index.html (no-FOUC); these helpers manage runtime
// changes and keep the choice in localStorage.
export type Theme = "light" | "dark";

const KEY = "trailward:theme";

export function systemTheme(): Theme {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Saved preference, or the system default when none is stored. */
export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage blocked — fall through to system */
  }
  return systemTheme();
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Toggle the `dark` class on <html>, which drives Tailwind's dark: variants. */
export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
}

/**
 * Print in the light theme (spec 44 R5). Tailwind's dark: variants follow the
 * `dark` class, not the medium, so a dark-mode page printed near-white text on
 * white paper. The class comes off as the browser prepares to print and goes
 * back after. Returns the cleanup.
 */
export function printInLight(win: Window = window): () => void {
  const root = win.document.documentElement;
  let wasDark = false;
  const before = () => {
    wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
  };
  const after = () => {
    if (wasDark) root.classList.add("dark");
    wasDark = false;
  };
  win.addEventListener("beforeprint", before);
  win.addEventListener("afterprint", after);
  return () => {
    win.removeEventListener("beforeprint", before);
    win.removeEventListener("afterprint", after);
  };
}

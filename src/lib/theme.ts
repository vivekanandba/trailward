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
